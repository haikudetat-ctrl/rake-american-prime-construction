-- Phase 3b: reviews and referrals.
--
-- After the crew taps Done, the owner checks the job and taps Mark final.
-- That starts the aftercare sequence: warranty and the signed agreement now,
-- a "how did we do?" link a day later. A great answer gets the Google review
-- link and, a few days later, the homeowner's referral link. Anything less
-- goes to the office as a follow-up instead of a review request.
--
-- A friend who comes in through a referral link (or is tagged by the office)
-- is a lead like any other, remembered as referred. When that friend's job is
-- paid in full, the reward is earned; the owner pays it and records it.

create table public.review_settings (
  company_id uuid primary key references public.companies(id),
  google_review_url text check (google_review_url is null or google_review_url ~ '^https://'),
  reward_cents int not null default 10000 check (reward_cents between 0 and 100000),
  feedback_delay_hours int not null default 24 check (feedback_delay_hours between 0 and 336),
  referral_delay_days int not null default 3 check (referral_delay_days between 0 and 60),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.review_settings enable row level security;
revoke all on public.review_settings from anon, authenticated;
grant all on public.review_settings to service_role;

create table public.aftercare (
  job_id uuid primary key references public.roofing_jobs(id),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id),
  customer_name text not null,
  customer_phone text,
  token text not null unique,          -- the homeowner's feedback link
  referral_code text not null unique,  -- the homeowner's referral link
  final_at timestamptz not null default now(),
  final_by uuid,
  rating text check (rating in ('great', 'okay', 'poor')),
  comment text,
  responded_at timestamptz,
  review_clicked_at timestamptz,
  follow_up text not null default 'none' check (follow_up in ('none', 'open', 'resolved')),
  follow_up_note text,
  created_at timestamptz not null default now()
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  referrer_job_id uuid not null references public.aftercare(job_id),
  lead_id uuid not null unique references public.leads(id),
  status text not null default 'pending' check (status in ('pending', 'earned', 'paid', 'void')),
  reward_cents int not null,
  earned_at timestamptz,
  paid_at timestamptz,
  paid_method text check (paid_method in ('gift_card', 'bank', 'check', 'other')),
  paid_reference text,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index referrals_status_idx on public.referrals(company_id, status);
create trigger aftercare_audit after insert or update on public.aftercare for each row execute function app.audit();
create trigger referrals_audit after insert or update on public.referrals for each row execute function app.audit();

alter table public.aftercare enable row level security;
alter table public.referrals enable row level security;
revoke all on public.aftercare, public.referrals from anon, authenticated;
grant select on public.aftercare, public.referrals to authenticated;
grant all on public.aftercare, public.referrals to service_role;
create policy aftercare_staff_read on public.aftercare for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy referrals_staff_read on public.referrals for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Random, URL-safe identifiers without extensions: hex from UUIDs.
create function app.random_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create function app.new_referral_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_code text;
begin
  loop
    -- 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
    select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
    into v_code from generate_series(1, 8);
    exit when not exists (select 1 from public.aftercare where referral_code = v_code);
  end loop;
  return v_code;
end;
$$;

create function app.review_setting(p_company uuid) returns public.review_settings
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s from public.review_settings s where s.company_id = p_company),
    row(p_company, null, 10000, 24, 3, null, now())::public.review_settings
  )
$$;

-- Mark final: start aftercare ---------------------------------------------------------

create function public.mark_job_final(p_job_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_job public.roofing_jobs;
  v_lead public.leads;
  v_settings public.review_settings;
  v_token text := app.random_token();
  v_proposal public.proposals;
  v_texting boolean;
begin
  select * into v_job from public.roofing_jobs where id = p_job_id and company_id = v_company for update;
  if v_job.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  if v_job.status <> 'done' then raise exception 'the crew has to mark the job done first'; end if;
  if exists (select 1 from public.aftercare where job_id = v_job.id) then raise exception 'this job is already final'; end if;
  select * into v_lead from public.leads where id = v_job.lead_id;
  select * into v_proposal from public.proposals where id = v_job.proposal_id;
  v_settings := app.review_setting(v_company);

  insert into public.aftercare (job_id, company_id, lead_id, customer_name, customer_phone, token, referral_code, final_by)
  values (v_job.id, v_company, v_lead.id, v_job.customer_name, v_job.customer_phone, v_token, app.new_referral_code(), auth.uid());
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_company, v_lead.id, 'note', 'Job marked final: warranty sent, feedback request scheduled', auth.uid());

  v_texting := v_job.customer_phone is not null and not exists (
    select 1 from public.sms_opt_outs where company_id = v_company and phone = v_job.customer_phone and opted_in_at is null);
  if v_texting then
    perform app.enqueue(v_company, 'sms', 'aftercare_warranty',
      jsonb_build_object('to', v_job.customer_phone, 'job_id', v_job.id, 'name', v_job.customer_name,
                         'system', v_job.system_name, 'proposal_token', v_proposal.public_token),
      'aftercare:' || v_job.id || ':warranty:sms');
    perform app.enqueue(v_company, 'sms', 'feedback_request',
      jsonb_build_object('to', v_job.customer_phone, 'job_id', v_job.id, 'name', v_job.customer_name, 'token', v_token),
      'aftercare:' || v_job.id || ':feedback', now() + make_interval(hours => v_settings.feedback_delay_hours));
  end if;
  if v_lead.email is not null then
    perform app.enqueue(v_company, 'email', 'aftercare_warranty',
      jsonb_build_object('to', v_lead.email, 'job_id', v_job.id, 'proposal_id', v_proposal.id, 'token', v_token),
      'aftercare:' || v_job.id || ':warranty:email');
  end if;
end;
$$;

-- Homeowner feedback (server only, by token) ------------------------------------------

create function public.submit_feedback(p_token text, p_rating text, p_comment text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_care public.aftercare;
  v_settings public.review_settings;
begin
  select * into v_care from public.aftercare where token = p_token for update;
  if v_care.job_id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_rating not in ('great', 'okay', 'poor') then raise exception 'choose an answer'; end if;
  if v_care.responded_at is not null then return v_care.rating; end if;
  v_settings := app.review_setting(v_care.company_id);

  update public.aftercare set rating = p_rating, comment = nullif(trim(coalesce(p_comment, '')), ''),
    responded_at = now(), follow_up = case when p_rating = 'great' then 'none' else 'open' end
  where job_id = v_care.job_id;
  insert into public.lead_events (company_id, lead_id, kind, body)
  values (v_care.company_id, v_care.lead_id, 'note',
          format('Homeowner feedback: %s%s', p_rating, coalesce(' — ' || nullif(trim(coalesce(p_comment, '')), ''), '')));

  if p_rating = 'great' then
    if v_care.customer_phone is not null then
      perform app.enqueue(v_care.company_id, 'sms', 'referral_invite',
        jsonb_build_object('to', v_care.customer_phone, 'job_id', v_care.job_id, 'name', v_care.customer_name,
                           'code', v_care.referral_code, 'reward_cents', v_settings.reward_cents),
        'aftercare:' || v_care.job_id || ':referral', now() + make_interval(days => v_settings.referral_delay_days));
    end if;
  else
    perform app.notify_staff(v_care.company_id, 'feedback_followup',
      jsonb_build_object('job_id', v_care.job_id, 'lead_id', v_care.lead_id, 'name', v_care.customer_name,
                         'rating', p_rating, 'comment', left(coalesce(p_comment, ''), 140)),
      'followup:' || v_care.job_id);
  end if;
  return p_rating;
end;
$$;

create function public.record_review_click(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_care public.aftercare;
begin
  update public.aftercare set review_clicked_at = coalesce(review_clicked_at, now())
  where token = p_token and rating = 'great'
  returning * into v_care;
  if v_care.job_id is null then return null; end if;
  return (app.review_setting(v_care.company_id)).google_review_url;
end;
$$;

create function public.resolve_follow_up(p_job_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'say how it was resolved'; end if;
  update public.aftercare set follow_up = 'resolved', follow_up_note = trim(p_note)
  where job_id = p_job_id and company_id = v_company and follow_up = 'open';
  if not found then raise exception 'no open follow-up on this job'; end if;
end;
$$;

-- Referrals ----------------------------------------------------------------------------

-- A friend's request through /r/<code> (server only; the app validates and geocodes first).
create function public.submit_referral_lead(
  p_code text, p_name text, p_phone text, p_email text, p_address text, p_area text,
  p_lat double precision, p_lng double precision, p_place_id text, p_need text, p_notes text,
  p_consent_text text, p_submitter_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_care public.aftercare;
  v_brand uuid;
  v_lead public.leads;
  v_recent int;
begin
  select * into v_care from public.aftercare where referral_code = upper(p_code);
  if v_care.job_id is null then raise exception 'unknown referral link' using errcode = 'P0002'; end if;
  select count(*) into v_recent from public.leads
  where submitter_hash = p_submitter_hash and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited'; end if;
  select id into v_brand from public.brands where company_id = v_care.company_id and kind = 'roofing';

  insert into public.leads (company_id, brand_id, source, name, phone, email, address, area, lat, lng, place_id,
                            need, notes, contact_consent_at, contact_consent_text, submitter_hash)
  values (v_care.company_id, v_brand, 'referral', trim(p_name), nullif(p_phone, ''), nullif(p_email, ''), p_address,
          nullif(p_area, ''), p_lat, p_lng, nullif(p_place_id, ''), p_need,
          concat_ws(E'\n', 'Referred by ' || v_care.customer_name, nullif(p_notes, '')),
          case when p_consent_text is not null then now() end, p_consent_text, p_submitter_hash)
  returning * into v_lead;
  insert into public.lead_events (company_id, lead_id, kind, to_stage, body)
  values (v_lead.company_id, v_lead.id, 'created', 'new', 'Referred by ' || v_care.customer_name);
  insert into public.referrals (company_id, referrer_job_id, lead_id, reward_cents)
  values (v_care.company_id, v_care.job_id, v_lead.id, (app.review_setting(v_care.company_id)).reward_cents);
  perform app.emit(v_lead.company_id, 'lead', v_lead.id, 'lead_submitted', jsonb_build_object('referral', true));
  perform app.lead_staff_notify(v_lead);
  return v_lead.id;
end;
$$;

-- Office tags an existing lead as referred by a past customer.
create function public.set_lead_referrer(p_lead_id uuid, p_referrer_job_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_care public.aftercare;
begin
  select * into v_care from public.aftercare where job_id = p_referrer_job_id and company_id = v_company;
  if v_care.job_id is null then raise exception 'choose a past customer'; end if;
  if not exists (select 1 from public.leads where id = p_lead_id and company_id = v_company) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if v_care.lead_id = p_lead_id then raise exception 'a customer cannot refer themselves'; end if;
  if exists (select 1 from public.referrals where lead_id = p_lead_id and status in ('earned', 'paid')) then
    raise exception 'this referral reward is already earned';
  end if;
  insert into public.referrals (company_id, referrer_job_id, lead_id, reward_cents, created_by)
  values (v_company, v_care.job_id, p_lead_id, (app.review_setting(v_company)).reward_cents, auth.uid())
  on conflict (lead_id) do update set referrer_job_id = excluded.referrer_job_id, status = 'pending', void_reason = null;
  update public.leads set source = 'referral' where id = p_lead_id;
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_company, p_lead_id, 'note', 'Referred by ' || v_care.customer_name, auth.uid());
end;
$$;

-- When a referred friend's job is paid in full, the reward is earned.
create function app.referral_on_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs;
  v_paid int;
  v_ref public.referrals;
  v_care public.aftercare;
begin
  select * into v_job from public.roofing_jobs where id = new.job_id;
  select coalesce(sum(amount_cents), 0) into v_paid from public.job_payments where job_id = v_job.id and voided_at is null;
  if v_paid < v_job.total_cents then return null; end if;
  update public.referrals set status = 'earned', earned_at = now()
  where lead_id = v_job.lead_id and status = 'pending'
  returning * into v_ref;
  if v_ref.id is null then return null; end if;
  select * into v_care from public.aftercare where job_id = v_ref.referrer_job_id;
  insert into public.lead_events (company_id, lead_id, kind, body)
  values (v_care.company_id, v_care.lead_id, 'note',
          format('Referral reward earned: %s (%s paid in full)', to_char(v_ref.reward_cents / 100.0, 'FM$999,990.00'), v_job.customer_name));
  perform app.notify_staff(v_care.company_id, 'reward_owed',
    jsonb_build_object('referral_id', v_ref.id, 'referrer', v_care.customer_name, 'friend', v_job.customer_name,
                       'reward_cents', v_ref.reward_cents),
    'reward:' || v_ref.id);
  if v_care.customer_phone is not null then
    perform app.enqueue(v_care.company_id, 'sms', 'referral_earned',
      jsonb_build_object('to', v_care.customer_phone, 'name', v_care.customer_name, 'friend', v_job.customer_name,
                         'reward_cents', v_ref.reward_cents),
      'reward:' || v_ref.id || ':earned');
  end if;
  return null;
end;
$$;
create trigger job_payments_referral after insert on public.job_payments
  for each row execute function app.referral_on_payment();

create function public.mark_reward_paid(p_referral_id uuid, p_method text, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_ref public.referrals;
  v_care public.aftercare;
  v_friend text;
begin
  update public.referrals set status = 'paid', paid_at = now(), paid_method = p_method,
    paid_reference = nullif(trim(coalesce(p_reference, '')), '')
  where id = p_referral_id and company_id = v_company and status = 'earned'
  returning * into v_ref;
  if v_ref.id is null then raise exception 'only an earned reward can be marked paid'; end if;
  select * into v_care from public.aftercare where job_id = v_ref.referrer_job_id;
  select name into v_friend from public.leads where id = v_ref.lead_id;
  if v_care.customer_phone is not null then
    perform app.enqueue(v_company, 'sms', 'referral_paid',
      jsonb_build_object('to', v_care.customer_phone, 'name', v_care.customer_name, 'friend', v_friend,
                         'reward_cents', v_ref.reward_cents, 'method', p_method),
      'reward:' || v_ref.id || ':paid');
  end if;
end;
$$;

create function public.void_referral(p_referral_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  update public.referrals set status = 'void', void_reason = trim(p_reason)
  where id = p_referral_id and company_id = v_company and status in ('pending', 'earned');
  if not found then raise exception 'only a pending or earned referral can be voided'; end if;
end;
$$;

create function public.review_numbers(p_since date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select app.require_staff() as id)
  select jsonb_build_object(
    'finals', (select count(*) from public.aftercare a, c where a.company_id = c.id and a.final_at >= p_since),
    'responses', (select count(*) from public.aftercare a, c where a.company_id = c.id and a.final_at >= p_since and a.responded_at is not null),
    'great', (select count(*) from public.aftercare a, c where a.company_id = c.id and a.final_at >= p_since and a.rating = 'great'),
    'review_clicks', (select count(*) from public.aftercare a, c where a.company_id = c.id and a.final_at >= p_since and a.review_clicked_at is not null),
    'open_follow_ups', (select count(*) from public.aftercare a, c where a.company_id = c.id and a.follow_up = 'open'),
    'referrals', (select count(*) from public.referrals r, c where r.company_id = c.id and r.created_at >= p_since and r.status <> 'void'),
    'referrals_won', (select count(*) from public.referrals r join public.leads l on l.id = r.lead_id, c
                      where r.company_id = c.id and r.created_at >= p_since and l.stage = 'won'),
    'rewards_owed_cents', (select coalesce(sum(reward_cents), 0) from public.referrals r, c where r.company_id = c.id and r.status = 'earned')
  )
$$;

-- Grants -----------------------------------------------------------------------------

revoke execute on function app.random_token(), app.new_referral_code(), app.review_setting(uuid), app.referral_on_payment()
  from public, anon, authenticated;
grant execute on function app.random_token(), app.new_referral_code(), app.review_setting(uuid) to service_role;

revoke execute on function
  public.mark_job_final(uuid),
  public.submit_feedback(text, text, text),
  public.record_review_click(text),
  public.resolve_follow_up(uuid, text),
  public.submit_referral_lead(text, text, text, text, text, text, double precision, double precision, text, text, text, text, text),
  public.set_lead_referrer(uuid, uuid),
  public.mark_reward_paid(uuid, text, text),
  public.void_referral(uuid, text),
  public.review_numbers(date)
from public, anon;
revoke execute on function
  public.submit_feedback(text, text, text),
  public.record_review_click(text),
  public.submit_referral_lead(text, text, text, text, text, text, double precision, double precision, text, text, text, text, text)
from authenticated;
grant execute on function
  public.mark_job_final(uuid),
  public.resolve_follow_up(uuid, text),
  public.set_lead_referrer(uuid, uuid),
  public.mark_reward_paid(uuid, text, text),
  public.void_referral(uuid, text),
  public.review_numbers(date)
to authenticated;
grant execute on function
  public.mark_job_final(uuid),
  public.submit_feedback(text, text, text),
  public.record_review_click(text),
  public.resolve_follow_up(uuid, text),
  public.submit_referral_lead(text, text, text, text, text, text, double precision, double precision, text, text, text, text, text),
  public.set_lead_referrer(uuid, uuid),
  public.mark_reward_paid(uuid, text, text),
  public.void_referral(uuid, text),
  public.review_numbers(date)
to service_role;
