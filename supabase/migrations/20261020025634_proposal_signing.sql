-- Phase 2d: send a proposal, the homeowner signs it, the job is won.
--
-- Sending locks the proposal: it gets an unguessable link token, a copy of the
-- terms, and a SHA-256 of exactly what the homeowner will see. Signing checks
-- that hash again, takes the price from the stored proposal (never from the
-- browser), records who signed, when, from where and the drawn signature,
-- marks the lead won and creates the roofing job. Changing a sent proposal
-- means a new version; sending that version voids the old one.
--
-- Crews see their jobs through crew_jobs(), which carries no prices.

create table public.proposal_settings (
  company_id uuid primary key references public.companies(id),
  terms text not null,
  valid_days int not null default 30 check (valid_days between 1 and 365),
  hic_number text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.proposal_settings enable row level security;
revoke all on public.proposal_settings from anon, authenticated;
grant all on public.proposal_settings to service_role;

alter table public.proposals
  add column public_token text unique,
  add column content_hash text,
  add column terms text,
  add column sent_at timestamptz,
  add column sent_by uuid,
  add column expires_at timestamptz,
  add column viewed_at timestamptz,
  add column signed_at timestamptz,
  add column replaces_id uuid references public.proposals(id),
  add column void_reason text;

create table public.proposal_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  proposal_id uuid not null unique references public.proposals(id),
  system_id text not null,
  option jsonb not null,
  addons jsonb not null,
  total_cents int not null check (total_cents > 0),
  signer_name text not null,
  signature_path text not null,
  ip text,
  user_agent text,
  content_hash text not null,
  signed_at timestamptz not null default now()
);

create table public.roofing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id),
  proposal_id uuid not null unique references public.proposals(id),
  customer_name text not null,
  customer_phone text,
  address text,
  lat double precision,
  lng double precision,
  system_name text not null,
  -- What the crew needs: measurements, add-ons, notes. No prices.
  scope jsonb not null,
  total_cents int not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'done')),
  install_date date,
  crew_ids uuid[] not null default '{}',
  notes text,
  started_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index roofing_jobs_company_idx on public.roofing_jobs(company_id, status, install_date);
create trigger roofing_jobs_touch before update on public.roofing_jobs for each row execute function app.touch_updated_at();
create trigger roofing_jobs_audit after insert or update on public.roofing_jobs for each row execute function app.audit();

alter table public.proposal_signatures enable row level security;
alter table public.roofing_jobs enable row level security;
revoke all on public.proposal_signatures, public.roofing_jobs from anon, authenticated;
grant select on public.proposal_signatures, public.roofing_jobs to authenticated;
grant all on public.proposal_signatures, public.roofing_jobs to service_role;
create policy proposal_signatures_staff_read on public.proposal_signatures for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy roofing_jobs_staff_read on public.roofing_jobs for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Drawn signatures, private.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('signatures', 'signatures', false, 1048576, array['image/png'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Sending ---------------------------------------------------------------------------

-- Server only (the app makes the token and the hash of what it will show).
create function public.send_proposal(
  p_company_id uuid,
  p_actor uuid,
  p_proposal_id uuid,
  p_token text,
  p_content_hash text,
  p_terms text,
  p_valid_days int,
  p_by_text boolean,
  p_by_email boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.proposals;
  v_lead public.leads;
  v_link text;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id and company_id = p_company_id for update;
  if v_proposal.id is null then raise exception 'proposal not found' using errcode = 'P0002'; end if;
  if v_proposal.status <> 'draft' then raise exception 'this proposal was already sent'; end if;
  if v_proposal.needs_confirmation then
    raise exception 'priced from placeholder numbers: confirm the roofing price list, then re-price before sending';
  end if;
  if length(p_token) < 32 then raise exception 'bad token'; end if;
  select * into v_lead from public.leads where id = v_proposal.lead_id;
  if not p_by_text and not p_by_email then raise exception 'choose text, email or both'; end if;
  if p_by_text and v_lead.phone is null then raise exception 'this lead has no phone number'; end if;
  if p_by_email and v_lead.email is null then raise exception 'this lead has no email address'; end if;
  if p_by_text and exists (select 1 from public.sms_opt_outs where company_id = p_company_id
                           and phone = v_lead.phone and opted_in_at is null) then
    raise exception 'this homeowner replied STOP to texts; send by email';
  end if;

  update public.proposals set
    status = 'sent', public_token = p_token, content_hash = p_content_hash, terms = p_terms,
    sent_at = now(), sent_by = p_actor, expires_at = now() + make_interval(days => p_valid_days)
  where id = v_proposal.id;
  -- A new version replaces the one it was made from.
  update public.proposals set status = 'void', void_reason = format('replaced by #%s', v_proposal.number)
  where id = v_proposal.replaces_id and status = 'sent';

  if v_lead.stage in ('new', 'contacted', 'appointment') then
    update public.leads set stage = 'proposal_sent', stage_changed_at = now() where id = v_lead.id;
    insert into public.lead_events (company_id, lead_id, kind, from_stage, to_stage, actor_id)
    values (p_company_id, v_lead.id, 'stage', v_lead.stage, 'proposal_sent', p_actor);
  end if;
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (p_company_id, v_lead.id, 'note',
          format('Proposal #%s sent by %s', v_proposal.number,
                 concat_ws(' and ', case when p_by_text then 'text' end, case when p_by_email then 'email' end)),
          p_actor);

  if p_by_text then
    perform app.enqueue(p_company_id, 'sms', 'proposal_link',
      jsonb_build_object('to', v_lead.phone, 'proposal_id', v_proposal.id, 'token', p_token, 'name', v_lead.name),
      'proposal:' || v_proposal.id || ':text');
  end if;
  if p_by_email then
    perform app.enqueue(p_company_id, 'email', 'proposal_link',
      jsonb_build_object('to', v_lead.email, 'proposal_id', v_proposal.id, 'token', p_token, 'name', v_lead.name),
      'proposal:' || v_proposal.id || ':email');
  end if;
end;
$$;

-- Copy a sent (or void) proposal into a new draft to change it.
create function public.revise_proposal(p_proposal_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_old public.proposals;
  v_id uuid;
begin
  select * into v_old from public.proposals where id = p_proposal_id and company_id = v_company;
  if v_old.id is null then raise exception 'proposal not found' using errcode = 'P0002'; end if;
  if v_old.status = 'draft' then raise exception 'this proposal is still a draft: change it directly'; end if;
  if v_old.status = 'signed' then raise exception 'a signed proposal cannot be changed'; end if;
  insert into public.proposals (
    company_id, lead_id, number, catalog_version_id, needs_confirmation, measurement_id,
    measurement, inputs, options, addons, warnings, created_by, replaces_id
  ) values (
    v_company, v_old.lead_id, app.next_number(v_company, 'proposal'), v_old.catalog_version_id, v_old.needs_confirmation,
    v_old.measurement_id, v_old.measurement, v_old.inputs, v_old.options, v_old.addons, v_old.warnings, auth.uid(), v_old.id
  ) returning id into v_id;
  insert into public.proposal_costs (proposal_id, company_id, breakdown)
  select v_id, company_id, breakdown from public.proposal_costs where proposal_id = v_old.id;
  return v_id;
end;
$$;

-- Homeowner (server only, by token) -----------------------------------------------------

create function public.record_proposal_view(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.proposals;
begin
  update public.proposals set viewed_at = now()
  where public_token = p_token and viewed_at is null and status = 'sent'
  returning * into v_proposal;
  if v_proposal.id is not null then
    insert into public.lead_events (company_id, lead_id, kind, body)
    values (v_proposal.company_id, v_proposal.lead_id, 'note', format('Proposal #%s opened by the homeowner', v_proposal.number));
  end if;
end;
$$;

create function public.sign_proposal(
  p_token text,
  p_system_id text,
  p_addon_ids text[],
  p_signer_name text,
  p_signature_path text,
  p_ip text,
  p_user_agent text,
  p_content_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.proposals;
  v_lead public.leads;
  v_option jsonb;
  v_addons jsonb;
  v_total int;
  v_job uuid;
begin
  select * into v_proposal from public.proposals where public_token = p_token for update;
  if v_proposal.id is null then raise exception 'proposal not found' using errcode = 'P0002'; end if;
  if v_proposal.status = 'signed' then raise exception 'this proposal is already signed'; end if;
  if v_proposal.status <> 'sent' then raise exception 'this proposal is no longer open; ask us for the current one'; end if;
  if v_proposal.expires_at < now() then raise exception 'this proposal has expired; ask us for an updated one'; end if;
  if p_content_hash is distinct from v_proposal.content_hash then
    raise exception 'this proposal changed since the page was opened; reload it';
  end if;
  if length(trim(coalesce(p_signer_name, ''))) < 2 then raise exception 'type your full name'; end if;

  select o into v_option from jsonb_array_elements(v_proposal.options) o where o ->> 'systemId' = p_system_id;
  if v_option is null then raise exception 'choose one of the options'; end if;
  select coalesce(jsonb_agg(a), '[]') into v_addons
  from jsonb_array_elements(v_proposal.addons) a where a ->> 'addonId' = any(coalesce(p_addon_ids, '{}'));
  if jsonb_array_length(v_addons) <> cardinality(array(select distinct x from unnest(coalesce(p_addon_ids, '{}')) x)) then
    raise exception 'an add-on is not on this proposal';
  end if;
  v_total := coalesce((v_option ->> 'overrideCents')::int, (v_option ->> 'priceCents')::int)
    + coalesce((select sum((a ->> 'priceCents')::int) from jsonb_array_elements(v_addons) a), 0);

  insert into public.proposal_signatures (
    company_id, proposal_id, system_id, option, addons, total_cents, signer_name, signature_path,
    ip, user_agent, content_hash
  ) values (
    v_proposal.company_id, v_proposal.id, p_system_id, v_option, v_addons, v_total, trim(p_signer_name),
    p_signature_path, left(p_ip, 100), left(p_user_agent, 500), v_proposal.content_hash
  );
  update public.proposals set status = 'signed', signed_at = now() where id = v_proposal.id;

  select * into v_lead from public.leads where id = v_proposal.lead_id for update;
  if v_lead.stage <> 'won' then
    update public.leads set stage = 'won', stage_changed_at = now(), lost_reason = null where id = v_lead.id;
    insert into public.lead_events (company_id, lead_id, kind, from_stage, to_stage, body)
    values (v_lead.company_id, v_lead.id, 'stage', v_lead.stage, 'won', 'Signed online');
  end if;
  insert into public.lead_events (company_id, lead_id, kind, body)
  values (v_lead.company_id, v_lead.id, 'note',
          format('Proposal #%s signed by %s: %s, $%s', v_proposal.number, trim(p_signer_name), v_option ->> 'name',
                 to_char(v_total / 100.0, 'FM999,999,990.00')));

  insert into public.roofing_jobs (
    company_id, lead_id, proposal_id, customer_name, customer_phone, address, lat, lng,
    system_name, scope, total_cents
  ) values (
    v_lead.company_id, v_lead.id, v_proposal.id, v_lead.name, v_lead.phone, v_lead.address, v_lead.lat, v_lead.lng,
    v_option ->> 'name',
    jsonb_build_object('measurement', v_proposal.measurement,
                       'addons', (select coalesce(jsonb_agg(jsonb_build_object('name', a ->> 'name', 'qty', a -> 'qty', 'unit', a ->> 'unitLabel')), '[]')
                                  from jsonb_array_elements(v_addons) a)),
    v_total
  ) returning id into v_job;

  perform app.notify_staff(v_lead.company_id, 'proposal_signed',
    jsonb_build_object('proposal_id', v_proposal.id, 'lead_id', v_lead.id, 'name', v_lead.name,
                       'option', v_option ->> 'name', 'total_cents', v_total),
    'signed:' || v_proposal.id);
  if v_lead.email is not null then
    perform app.enqueue(v_lead.company_id, 'email', 'proposal_signed',
      jsonb_build_object('to', v_lead.email, 'proposal_id', v_proposal.id), 'signed:' || v_proposal.id || ':homeowner');
  end if;
  return v_job;
end;
$$;

-- Jobs ------------------------------------------------------------------------------

create function public.schedule_roofing_job(p_job_id uuid, p_install_date date, p_crew_ids uuid[], p_notes text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  if exists (select 1 from unnest(coalesce(p_crew_ids, '{}')) c
             where not exists (select 1 from public.memberships m where m.user_id = c and m.company_id = v_company
                               and m.is_active and m.role in ('crew', 'owner', 'office', 'driver'))) then
    raise exception 'that person is not on the team';
  end if;
  update public.roofing_jobs set install_date = p_install_date, crew_ids = coalesce(p_crew_ids, '{}'), notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_job_id and company_id = v_company;
  if not found then raise exception 'job not found' using errcode = 'P0002'; end if;
end;
$$;

-- What a crew member sees: their jobs, no money.
create function public.crew_jobs() returns table (
  job_id uuid, customer_name text, customer_phone text, address text, lat double precision, lng double precision,
  system_name text, scope jsonb, status text, install_date date, notes text
)
language sql stable security definer set search_path = '' as $$
  select j.id, j.customer_name, j.customer_phone, j.address, j.lat, j.lng, j.system_name, j.scope, j.status,
         j.install_date, j.notes
  from public.roofing_jobs j
  where j.company_id = app.current_company_id()
    and (auth.uid() = any(j.crew_ids) or app.is_staff())
    and (j.status <> 'done' or j.done_at > now() - interval '7 days')
  order by j.install_date nulls last, j.created_at
$$;

create function public.set_roofing_job_status(p_job_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs;
begin
  select * into v_job from public.roofing_jobs where id = p_job_id and company_id = app.current_company_id() for update;
  if v_job.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  if not (auth.uid() = any(v_job.crew_ids) or app.is_staff()) then
    raise exception 'not your job' using errcode = '42501';
  end if;
  if p_status not in ('scheduled', 'in_progress', 'done') then raise exception 'unknown status'; end if;
  update public.roofing_jobs set
    status = p_status,
    started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
    done_at = case when p_status = 'done' then now() when p_status <> 'done' then null else done_at end
  where id = v_job.id;
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_job.company_id, v_job.lead_id, 'note',
          case p_status when 'in_progress' then 'Job started' when 'done' then 'Job done' else 'Job back to scheduled' end,
          auth.uid());
end;
$$;

-- Grants -----------------------------------------------------------------------------

revoke execute on function
  public.send_proposal(uuid, uuid, uuid, text, text, text, int, boolean, boolean),
  public.revise_proposal(uuid),
  public.record_proposal_view(text),
  public.sign_proposal(text, text, text[], text, text, text, text, text),
  public.schedule_roofing_job(uuid, date, uuid[], text),
  public.crew_jobs(),
  public.set_roofing_job_status(uuid, text)
from public, anon;
revoke execute on function
  public.send_proposal(uuid, uuid, uuid, text, text, text, int, boolean, boolean),
  public.record_proposal_view(text),
  public.sign_proposal(text, text, text[], text, text, text, text, text)
from authenticated;
grant execute on function
  public.revise_proposal(uuid),
  public.schedule_roofing_job(uuid, date, uuid[], text),
  public.crew_jobs(),
  public.set_roofing_job_status(uuid, text)
to authenticated;
grant execute on function
  public.send_proposal(uuid, uuid, uuid, text, text, text, int, boolean, boolean),
  public.revise_proposal(uuid),
  public.record_proposal_view(text),
  public.sign_proposal(text, text, text[], text, text, text, text, text),
  public.schedule_roofing_job(uuid, date, uuid[], text),
  public.crew_jobs(),
  public.set_roofing_job_status(uuid, text)
to service_role;
