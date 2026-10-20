-- Phase 2a: roofing leads, the homeowner request link, and the sales pipeline.
--
-- A lead is one homeowner and one property. It moves through the stages Andrey
-- described on the Oct 12 call: new → contacted → appointment → proposal_sent →
-- won | lost. Every move is a row in lead_events, so the timeline and the
-- numbers (time in stage, win rate) come from the same history.
--
-- Leads are staff-only (owner, office). Crews and drivers never see them.

-- A roofing link is a request link on the roofing brand. The dumpster form
-- refuses roofing links and the roofing form refuses dumpster links.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  brand_id uuid not null references public.brands(id),
  request_link_id uuid references public.request_links(id),
  source text not null check (source in ('link', 'phone', 'text', 'office', 'referral')),
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'appointment', 'proposal_sent', 'won', 'lost')),
  stage_changed_at timestamptz not null default now(),
  name text not null,
  phone text,
  email text,
  address text,
  area text,
  lat double precision,
  lng double precision,
  place_id text,
  need text not null default 'other'
    check (need in ('replacement', 'repair', 'inspection', 'gutters', 'storm', 'other')),
  notes text,
  appointment_at timestamptz,
  lost_reason text,
  -- What the homeowner agreed to on the form, kept word for word.
  contact_consent_at timestamptz,
  contact_consent_text text,
  submitter_hash text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
create index leads_company_stage_idx on public.leads(company_id, stage, stage_changed_at);
create index leads_phone_idx on public.leads(company_id, phone);
create trigger leads_touch before update on public.leads for each row execute function app.touch_updated_at();
create trigger leads_audit after insert or update on public.leads for each row execute function app.audit();

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('created', 'stage', 'note', 'edited')),
  from_stage text,
  to_stage text,
  body text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events(lead_id, created_at);

-- Photos the homeowner attached on the form. Stored in the private
-- lead-photos bucket; the office reads them through signed URLs.
create table public.lead_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now()
);

-- Past jobs shown on the public roofing link. Public bucket: these are
-- marketing photos meant to be seen.
create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  brand_id uuid not null references public.brands(id),
  path text not null unique,
  caption text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- RLS: staff read; every write goes through the functions below (or the
-- service role for the public link and uploads).
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.lead_photos enable row level security;
alter table public.gallery_photos enable row level security;

revoke all on public.leads, public.lead_events, public.lead_photos, public.gallery_photos from anon, authenticated;
grant select on public.leads, public.lead_events, public.lead_photos, public.gallery_photos to authenticated;
grant all on public.leads, public.lead_events, public.lead_photos, public.gallery_photos to service_role;

create policy leads_staff_read on public.leads for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy lead_events_staff_read on public.lead_events for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy lead_photos_staff_read on public.lead_photos for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy gallery_photos_staff_read on public.gallery_photos for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Storage: private homeowner photos, public gallery. Guarded for the
-- plain-Postgres test harness, which has no storage schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('lead-photos', 'lead-photos', false, 10485760,
       array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']),
      ('gallery', 'gallery', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- The roofing request link, on the roofing brand.
insert into public.request_links (company_id, brand_id, slug)
select b.company_id, b.id, 'roof'
from public.brands b join public.companies c on c.id = b.company_id
where c.slug = 'american-prime' and b.kind = 'roofing'
on conflict (slug) do nothing;

-- Workflow -------------------------------------------------------------------------

create function app.lead_staff_notify(p_lead public.leads) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_staff record;
begin
  for v_staff in
    select p.phone, p.locale from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.company_id = p_lead.company_id and m.is_active
      and m.role in ('owner', 'office') and p.phone is not null
  loop
    perform app.enqueue(
      p_lead.company_id, 'sms', 'lead_received',
      jsonb_build_object(
        'to', v_staff.phone, 'locale', v_staff.locale, 'lead_id', p_lead.id,
        'name', p_lead.name, 'need', p_lead.need, 'address', p_lead.address, 'source', p_lead.source
      ),
      'lead:' || p_lead.id || ':notify:' || v_staff.phone
    );
  end loop;
end;
$$;

-- Public roofing link (service role only; the app validates and geocodes first).
create function public.submit_lead_request(
  p_slug text,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_place_id text,
  p_need text,
  p_notes text,
  p_consent_text text,
  p_submitter_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.request_links;
  v_lead public.leads;
  v_recent int;
begin
  select l.* into v_link from public.request_links l
  join public.brands b on b.id = l.brand_id
  where l.slug = p_slug and l.is_active and b.kind = 'roofing';
  if v_link.id is null then
    raise exception 'unknown request link' using errcode = 'P0002';
  end if;

  select count(*) into v_recent from public.leads
  where submitter_hash = p_submitter_hash and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.leads (
    company_id, brand_id, request_link_id, source, name, phone, email, address, area,
    lat, lng, place_id, need, notes, contact_consent_at, contact_consent_text, submitter_hash
  ) values (
    v_link.company_id, v_link.brand_id, v_link.id, 'link', trim(p_name), nullif(p_phone, ''),
    nullif(p_email, ''), p_address, nullif(p_area, ''), p_lat, p_lng, nullif(p_place_id, ''),
    p_need, nullif(p_notes, ''), case when p_consent_text is not null then now() end,
    p_consent_text, p_submitter_hash
  ) returning * into v_lead;

  insert into public.lead_events (company_id, lead_id, kind, to_stage)
  values (v_lead.company_id, v_lead.id, 'created', 'new');
  perform app.emit(v_lead.company_id, 'lead', v_lead.id, 'lead_submitted');
  perform app.lead_staff_notify(v_lead);
  return v_lead.id;
end;
$$;

-- Office enters a lead from a call, a walk-up or a referral.
create function public.create_lead(
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_need text,
  p_notes text,
  p_source text default 'office'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_brand uuid;
  v_lead public.leads;
begin
  if p_source not in ('phone', 'text', 'office', 'referral') then
    raise exception 'unknown source %', p_source using errcode = '22023';
  end if;
  select id into v_brand from public.brands where company_id = v_company and kind = 'roofing';
  insert into public.leads (company_id, brand_id, source, name, phone, email, address, need, notes, created_by)
  values (v_company, v_brand, p_source, trim(p_name), nullif(p_phone, ''), nullif(p_email, ''),
          nullif(p_address, ''), p_need, nullif(p_notes, ''), auth.uid())
  returning * into v_lead;
  insert into public.lead_events (company_id, lead_id, kind, to_stage, actor_id)
  values (v_company, v_lead.id, 'created', 'new', auth.uid());
  perform app.emit(v_company, 'lead', v_lead.id, 'lead_created');
  return v_lead.id;
end;
$$;

-- Move a lead along (or back). Booking an appointment needs a time; losing a
-- lead needs a reason, so the win/loss numbers mean something.
create function public.move_lead(
  p_lead_id uuid,
  p_stage text,
  p_appointment_at timestamptz default null,
  p_lost_reason text default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_lead public.leads;
begin
  select * into v_lead from public.leads where id = p_lead_id and company_id = v_company for update;
  if v_lead.id is null then raise exception 'lead not found' using errcode = 'P0002'; end if;
  if p_stage not in ('new', 'contacted', 'appointment', 'proposal_sent', 'won', 'lost') then
    raise exception 'unknown stage %', p_stage using errcode = '22023';
  end if;
  if p_stage = 'appointment' and p_appointment_at is null and v_lead.appointment_at is null then
    raise exception 'pick the appointment date and time';
  end if;
  if p_stage = 'lost' and nullif(trim(coalesce(p_lost_reason, '')), '') is null then
    raise exception 'say why the lead was lost';
  end if;

  update public.leads set
    stage = p_stage,
    stage_changed_at = case when stage <> p_stage then now() else stage_changed_at end,
    appointment_at = coalesce(p_appointment_at, appointment_at),
    lost_reason = case when p_stage = 'lost' then trim(p_lost_reason) else null end
  where id = v_lead.id;

  insert into public.lead_events (company_id, lead_id, kind, from_stage, to_stage, body, actor_id)
  values (v_company, v_lead.id, 'stage', v_lead.stage, p_stage,
          nullif(trim(concat_ws(' — ',
            case when p_stage = 'lost' then trim(p_lost_reason) end,
            nullif(trim(coalesce(p_note, '')), ''))), ''),
          auth.uid());
  perform app.emit(v_company, 'lead', v_lead.id, 'lead_moved',
    jsonb_build_object('from', v_lead.stage, 'to', p_stage));
end;
$$;

create function public.add_lead_note(p_lead_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'write a note first'; end if;
  if not exists (select 1 from public.leads where id = p_lead_id and company_id = v_company) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_company, p_lead_id, 'note', trim(p_body), auth.uid());
end;
$$;

create function public.update_lead(
  p_lead_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_need text,
  p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  update public.leads set
    name = trim(p_name), phone = nullif(p_phone, ''), email = nullif(p_email, ''),
    address = nullif(p_address, ''), need = p_need, notes = nullif(p_notes, '')
  where id = p_lead_id and company_id = v_company;
  if not found then raise exception 'lead not found' using errcode = 'P0002'; end if;
  insert into public.lead_events (company_id, lead_id, kind, actor_id)
  values (v_company, p_lead_id, 'edited', auth.uid());
end;
$$;

-- Pipeline numbers for the Numbers page. `p_since` bounds the win rate and
-- source counts; open-stage counts are always current.
create function public.lead_numbers(p_since date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  return jsonb_build_object(
    'by_stage', (
      select coalesce(jsonb_object_agg(stage, n), '{}') from (
        select stage, count(*) as n from public.leads where company_id = v_company group by stage
      ) s),
    'new_since', (
      select count(*) from public.leads where company_id = v_company and created_at >= p_since),
    'by_source', (
      select coalesce(jsonb_object_agg(source, n), '{}') from (
        select source, count(*) as n from public.leads
        where company_id = v_company and created_at >= p_since group by source
      ) s),
    'won', (
      select count(*) from public.leads
      where company_id = v_company and stage = 'won' and stage_changed_at >= p_since),
    'lost', (
      select count(*) from public.leads
      where company_id = v_company and stage = 'lost' and stage_changed_at >= p_since),
    -- Proposals out more than a week with no answer: the "check on these" list.
    'stale_proposals', (
      select count(*) from public.leads
      where company_id = v_company and stage = 'proposal_sent' and stage_changed_at < now() - interval '7 days'),
    -- New leads nobody has contacted within a day.
    'uncontacted', (
      select count(*) from public.leads
      where company_id = v_company and stage = 'new' and created_at < now() - interval '1 day')
  );
end;
$$;

-- The dumpster form must not accept a roofing link.
create or replace function public.submit_rental_request(
  p_slug text,
  p_contact_name text,
  p_company_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_place_id text,
  p_requested_date date,
  p_size_yards int,
  p_notes text,
  p_submitter_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.request_links;
  v_id uuid;
  v_recent int;
  v_staff record;
begin
  select l.* into v_link from public.request_links l
  join public.brands b on b.id = l.brand_id
  where l.slug = p_slug and l.is_active and b.kind = 'dumpster';
  if v_link.id is null then
    raise exception 'unknown request link' using errcode = 'P0002';
  end if;

  if p_requested_date < app.company_today(v_link.company_id) then
    raise exception 'requested date is in the past' using errcode = '22023';
  end if;

  select count(*) into v_recent from public.rental_requests
  where submitter_hash = p_submitter_hash and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.rental_requests (
    company_id, request_link_id, contact_name, company_name, phone, email, address, area,
    lat, lng, place_id, requested_date, size_yards, notes, submitter_hash
  ) values (
    v_link.company_id, v_link.id, p_contact_name, nullif(p_company_name, ''), p_phone,
    nullif(p_email, ''), p_address, nullif(p_area, ''), p_lat, p_lng, nullif(p_place_id, ''),
    p_requested_date, p_size_yards, nullif(p_notes, ''), p_submitter_hash
  ) returning id into v_id;

  perform app.emit(v_link.company_id, 'rental_request', v_id, 'request_submitted');

  for v_staff in
    select p.phone, p.locale from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.company_id = v_link.company_id and m.is_active
      and m.role in ('owner', 'office') and p.phone is not null
  loop
    perform app.enqueue(
      v_link.company_id, 'sms', 'request_received',
      jsonb_build_object(
        'to', v_staff.phone, 'locale', v_staff.locale, 'request_id', v_id,
        'name', coalesce(nullif(p_company_name, ''), p_contact_name),
        'date', p_requested_date, 'address', p_address
      ),
      'request:' || v_id || ':notify:' || v_staff.phone
    );
  end loop;

  return v_id;
end;
$$;

-- Grants ---------------------------------------------------------------------------

revoke execute on function app.lead_staff_notify(public.leads) from public, anon, authenticated;
grant execute on function app.lead_staff_notify(public.leads) to service_role;

revoke execute on function
  public.submit_lead_request(text, text, text, text, text, text, double precision, double precision, text, text, text, text, text),
  public.create_lead(text, text, text, text, text, text, text),
  public.move_lead(uuid, text, timestamptz, text, text),
  public.add_lead_note(uuid, text),
  public.update_lead(uuid, text, text, text, text, text, text),
  public.lead_numbers(date)
from public, anon;
revoke execute on function
  public.submit_lead_request(text, text, text, text, text, text, double precision, double precision, text, text, text, text, text)
from authenticated;
grant execute on function
  public.create_lead(text, text, text, text, text, text, text),
  public.move_lead(uuid, text, timestamptz, text, text),
  public.add_lead_note(uuid, text),
  public.update_lead(uuid, text, text, text, text, text, text),
  public.lead_numbers(date)
to authenticated;
grant execute on function
  public.submit_lead_request(text, text, text, text, text, text, double precision, double precision, text, text, text, text, text),
  public.create_lead(text, text, text, text, text, text, text),
  public.move_lead(uuid, text, timestamptz, text, text),
  public.add_lead_note(uuid, text),
  public.update_lead(uuid, text, text, text, text, text, text),
  public.lead_numbers(date)
to service_role;
