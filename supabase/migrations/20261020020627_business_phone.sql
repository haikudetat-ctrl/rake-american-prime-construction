-- Phase 2b: the business phone number.
--
-- Calls to the Twilio number ring everyone on the ring list at once; whoever
-- presses 1 first gets the call (so a personal voicemail can't "answer" it).
-- No answer, or after hours: greeting, voicemail, and the caller becomes a lead
-- if we don't already know them. Texts land in a shared inbox, matched to the
-- lead or dumpster customer by phone; replies go out from the business number
-- through the outbox.
--
-- Twilio webhooks run as the service role. Staff read calls and texts; they
-- send texts through send_text so opt-outs are always checked. Calls and texts
-- link to a lead (or dumpster customer), and the lead page shows them in its
-- timeline alongside lead_events.

create table public.phone_settings (
  company_id uuid primary key references public.companies(id),
  business_number text,
  ring_numbers text[] not null default '{}',
  ring_seconds int not null default 20 check (ring_seconds between 10 and 60),
  -- ISO weekdays (1 = Monday) and wall-clock hours in the company's timezone.
  open_days int[] not null default '{1,2,3,4,5,6}',
  open_time time not null default '08:00',
  close_time time not null default '18:00',
  greeting text not null default 'Thanks for calling American Prime Construction. We can''t get to the phone right now. Please leave your name, address and what you need after the tone, and we''ll call you back.',
  after_hours_greeting text not null default 'Thanks for calling American Prime Construction. We''re closed right now. Please leave your name, address and what you need after the tone, and we''ll call you back first thing.',
  notify_texts boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.phone_settings enable row level security;
revoke all on public.phone_settings from anon, authenticated;
grant all on public.phone_settings to service_role;

create table public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  call_sid text not null unique,
  from_number text not null,
  to_number text,
  status text not null default 'ringing' check (status in ('ringing', 'answered', 'missed', 'voicemail')),
  after_hours boolean not null default false,
  duration_seconds int,
  recording_sid text,
  recording_url text,
  recording_seconds int,
  lead_id uuid references public.leads(id),
  customer_id uuid references public.customers(id),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index phone_calls_company_idx on public.phone_calls(company_id, created_at desc);
create index phone_calls_lead_idx on public.phone_calls(lead_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  direction text not null check (direction in ('in', 'out')),
  phone text not null, -- the other party, E.164
  body text not null default '',
  media_urls text[] not null default '{}',
  twilio_sid text unique,
  status text not null check (status in ('received', 'queued', 'sent', 'failed')),
  error text,
  lead_id uuid references public.leads(id),
  customer_id uuid references public.customers(id),
  sent_by uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_thread_idx on public.messages(company_id, phone, created_at);
create index messages_unread_idx on public.messages(company_id) where direction = 'in' and read_at is null;

-- STOP sets opted_out_at; START sets opted_in_at. Opted out = opted_in_at is null.
create table public.sms_opt_outs (
  company_id uuid not null references public.companies(id),
  phone text not null,
  opted_out_at timestamptz not null default now(),
  opted_in_at timestamptz,
  primary key (company_id, phone)
);

alter table public.phone_calls enable row level security;
alter table public.messages enable row level security;
alter table public.sms_opt_outs enable row level security;
revoke all on public.phone_calls, public.messages, public.sms_opt_outs from anon, authenticated;
grant select on public.phone_calls, public.messages, public.sms_opt_outs to authenticated;
grant all on public.phone_calls, public.messages, public.sms_opt_outs to service_role;
create policy phone_calls_staff_read on public.phone_calls for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy messages_staff_read on public.messages for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy sms_opt_outs_staff_read on public.sms_opt_outs for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- The company a Twilio number belongs to. One company per deployment today,
-- but the webhook still resolves it from the number that was called.
create function app.company_for_number(p_number text) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select company_id from public.phone_settings where business_number = p_number),
    (select id from public.companies order by created_at limit 1)
  )
$$;

-- Who this phone number is: the most recent lead with it, else a dumpster
-- customer with it. Creates a lead (source phone/text) only for a stranger.
create function app.match_caller(
  p_company uuid, p_phone text, p_source text, out lead_id uuid, out customer_id uuid, out created boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_brand uuid;
begin
  created := false;
  select l.id into lead_id from public.leads l
  where l.company_id = p_company and l.phone = p_phone
  order by (l.stage in ('won', 'lost')), l.created_at desc limit 1;
  if lead_id is not null then return; end if;

  select c.id into customer_id from public.customers c
  where c.company_id = p_company and c.phone = p_phone and c.is_active
  order by c.created_at limit 1;
  if customer_id is not null then return; end if;

  select id into v_brand from public.brands where company_id = p_company and kind = 'roofing';
  insert into public.leads (company_id, brand_id, source, name, phone, need)
  values (p_company, v_brand, p_source,
          case when p_source = 'text' then 'New texter ' else 'New caller ' end || p_phone, p_phone, 'other')
  returning id into lead_id;
  insert into public.lead_events (company_id, lead_id, kind, to_stage)
  values (p_company, lead_id, 'created', 'new');
  created := true;
end;
$$;

-- Texts staff with phones on file (owner, office): new texts and voicemails.
create function app.notify_staff(p_company uuid, p_kind text, p_payload jsonb, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_staff record;
begin
  for v_staff in
    select p.phone, p.locale from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.company_id = p_company and m.is_active
      and m.role in ('owner', 'office') and p.phone is not null
  loop
    perform app.enqueue(p_company, 'sms', p_kind,
      p_payload || jsonb_build_object('to', v_staff.phone, 'locale', v_staff.locale),
      p_dedupe || ':' || v_staff.phone);
  end loop;
end;
$$;

-- Webhooks (service role) -----------------------------------------------------------

create function public.record_inbound_call(p_call_sid text, p_from text, p_to text, p_after_hours boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.company_for_number(p_to);
  v_id uuid;
begin
  insert into public.phone_calls (company_id, call_sid, from_number, to_number, after_hours)
  values (v_company, p_call_sid, p_from, p_to, p_after_hours)
  on conflict (call_sid) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.phone_calls where call_sid = p_call_sid; end if;
  return v_id;
end;
$$;

-- The ring list finished: answered, or missed (no answer, busy, after hours).
-- A missed call from a stranger becomes a lead; from someone we know, it links
-- to them and shows on their timeline.
create function public.finish_call(p_call_sid text, p_answered boolean, p_duration_seconds int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_call public.phone_calls;
  v_match record;
begin
  select * into v_call from public.phone_calls where call_sid = p_call_sid for update;
  if v_call.id is null or v_call.status <> 'ringing' then return; end if;

  select * into v_match from app.match_caller(v_call.company_id, v_call.from_number, 'phone');
  update public.phone_calls set
    status = case when p_answered then 'answered' else 'missed' end,
    duration_seconds = p_duration_seconds,
    lead_id = v_match.lead_id,
    customer_id = v_match.customer_id,
    ended_at = now()
  where id = v_call.id;
end;
$$;

create function public.attach_voicemail(p_call_sid text, p_recording_sid text, p_recording_url text, p_seconds int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_call public.phone_calls;
  v_name text;
begin
  update public.phone_calls set
    status = 'voicemail', recording_sid = p_recording_sid, recording_url = p_recording_url,
    recording_seconds = p_seconds
  where call_sid = p_call_sid and recording_sid is null
  returning * into v_call;
  if v_call.id is null then return; end if;

  select coalesce((select name from public.leads where id = v_call.lead_id),
                  (select name from public.customers where id = v_call.customer_id)) into v_name;
  perform app.notify_staff(v_call.company_id, 'voicemail_received',
    jsonb_build_object('call_id', v_call.id, 'lead_id', v_call.lead_id, 'from', v_call.from_number,
                       'name', v_name, 'seconds', p_seconds),
    'voicemail:' || v_call.id);
end;
$$;

-- An inbound text. Idempotent on Twilio's message sid. STOP-type keywords
-- record an opt-out (Twilio's Messaging Service also blocks further sends);
-- START-type keywords clear it.
create function public.receive_text(p_sid text, p_from text, p_to text, p_body text, p_media text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.company_for_number(p_to);
  v_match record;
  v_id uuid;
  v_keyword text := upper(trim(coalesce(p_body, '')));
  v_notify boolean;
  v_name text;
begin
  if exists (select 1 from public.messages where twilio_sid = p_sid) then
    return (select id from public.messages where twilio_sid = p_sid);
  end if;

  if v_keyword in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE') then
    insert into public.sms_opt_outs (company_id, phone) values (v_company, p_from)
    on conflict (company_id, phone) do update set opted_out_at = now(), opted_in_at = null;
  elsif v_keyword in ('START', 'UNSTOP', 'YES', 'OPTIN') then
    update public.sms_opt_outs set opted_in_at = now()
    where company_id = v_company and phone = p_from and opted_in_at is null;
  end if;

  select * into v_match from app.match_caller(v_company, p_from, 'text');
  insert into public.messages (company_id, direction, phone, body, media_urls, twilio_sid, status, lead_id, customer_id)
  values (v_company, 'in', p_from, coalesce(p_body, ''), coalesce(p_media, '{}'), p_sid, 'received',
          v_match.lead_id, v_match.customer_id)
  returning id into v_id;

  select coalesce(notify_texts, true) into v_notify from public.phone_settings where company_id = v_company;
  if coalesce(v_notify, true) then
    select coalesce((select name from public.leads where id = v_match.lead_id),
                    (select name from public.customers where id = v_match.customer_id)) into v_name;
    perform app.notify_staff(v_company, 'text_received',
      jsonb_build_object('message_id', v_id, 'from', p_from, 'name', v_name, 'body', left(coalesce(p_body, ''), 120)),
      'text:' || v_id);
  end if;
  return v_id;
end;
$$;

-- The outbox delivered (or gave up on) an office reply.
create function public.mark_text_sent(p_message_id uuid, p_twilio_sid text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.messages set
    status = case when p_error is null then 'sent' else 'failed' end,
    twilio_sid = coalesce(p_twilio_sid, twilio_sid),
    error = p_error
  where id = p_message_id and direction = 'out'
$$;

-- Staff -----------------------------------------------------------------------------

-- Reply from the business number. Refuses numbers that opted out.
create function public.send_text(p_phone text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_id uuid;
  v_lead uuid;
  v_customer uuid;
begin
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'write a message first'; end if;
  if length(p_body) > 1600 then raise exception 'that message is too long for a text'; end if;
  if p_phone !~ '^\+1[2-9][0-9]{9}$' then raise exception 'not a US mobile number'; end if;
  if exists (select 1 from public.sms_opt_outs where company_id = v_company and phone = p_phone and opted_in_at is null) then
    raise exception 'this number replied STOP; they have to text START before we can text them';
  end if;

  select l.id into v_lead from public.leads l where l.company_id = v_company and l.phone = p_phone
  order by (l.stage in ('won', 'lost')), l.created_at desc limit 1;
  if v_lead is null then
    select c.id into v_customer from public.customers c
    where c.company_id = v_company and c.phone = p_phone and c.is_active order by c.created_at limit 1;
  end if;

  insert into public.messages (company_id, direction, phone, body, status, lead_id, customer_id, sent_by)
  values (v_company, 'out', p_phone, trim(p_body), 'queued', v_lead, v_customer, auth.uid())
  returning id into v_id;
  perform app.enqueue(v_company, 'sms', 'reply',
    jsonb_build_object('to', p_phone, 'body', trim(p_body), 'message_id', v_id), 'reply:' || v_id);
  return v_id;
end;
$$;

create function public.mark_thread_read(p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  update public.messages set read_at = now()
  where company_id = v_company and phone = p_phone and direction = 'in' and read_at is null;
end;
$$;

-- Grants -----------------------------------------------------------------------------

revoke execute on function
  app.company_for_number(text),
  app.match_caller(uuid, text, text),
  app.notify_staff(uuid, text, jsonb, text)
from public, anon, authenticated;
grant execute on function
  app.company_for_number(text),
  app.match_caller(uuid, text, text),
  app.notify_staff(uuid, text, jsonb, text)
to service_role;

revoke execute on function
  public.record_inbound_call(text, text, text, boolean),
  public.finish_call(text, boolean, int),
  public.attach_voicemail(text, text, text, int),
  public.receive_text(text, text, text, text, text[]),
  public.mark_text_sent(uuid, text, text),
  public.send_text(text, text),
  public.mark_thread_read(text)
from public, anon;
revoke execute on function
  public.record_inbound_call(text, text, text, boolean),
  public.finish_call(text, boolean, int),
  public.attach_voicemail(text, text, text, int),
  public.receive_text(text, text, text, text, text[]),
  public.mark_text_sent(uuid, text, text)
from authenticated;
grant execute on function public.send_text(text, text), public.mark_thread_read(text) to authenticated;
grant execute on function
  public.record_inbound_call(text, text, text, boolean),
  public.finish_call(text, boolean, int),
  public.attach_voicemail(text, text, text, int),
  public.receive_text(text, text, text, text, text[]),
  public.mark_text_sent(uuid, text, text),
  public.send_text(text, text),
  public.mark_thread_read(text)
to service_role;
