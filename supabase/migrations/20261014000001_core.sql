-- Core: tenancy, roles, events/outbox, audit. Shared by every phase.
--
-- One deployment serves one company, but every row still carries company_id
-- and every policy still scopes by it. That costs nothing now and means a
-- second DBA, or a second company, never needs a data migration.

create schema app;
grant usage on schema app to authenticated, service_role;

-- Tenancy -------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

-- A brand is a DBA. Customer-facing documents render from the brand, so a
-- rename is a single row update and never touches operational data.
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('roofing', 'dumpster')),
  display_name text not null,
  email text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  unique (company_id, kind)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  locale text not null default 'en' check (locale in ('en', 'es')),
  created_at timestamptz not null default now()
);

-- owner:  everything, including team and price book.
-- office: day-to-day operations and billing.
-- driver: their own assigned stops; never prices, invoices or billing data.
-- crew:   reserved for Phase 2 roofing jobs; sees nothing in Phase 1.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  role text not null check (role in ('owner', 'office', 'driver', 'crew')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);
create index memberships_company_role_idx on public.memberships(company_id, role);

-- Role helpers ----------------------------------------------------------------
-- SECURITY DEFINER so policies on other tables can consult memberships
-- without the caller needing (or being granted) read access to it.

create function app.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.company_id
  from public.memberships m
  where m.user_id = auth.uid() and m.is_active
  order by m.created_at
  limit 1
$$;

create function app.member_role() returns text
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid() and m.is_active
    and m.company_id = app.current_company_id()
$$;

create function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.member_role() in ('owner', 'office'), false)
$$;

create function app.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.member_role() = 'owner', false)
$$;

create function app.require_staff() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return app.current_company_id();
end;
$$;

revoke execute on all functions in schema app from public;
grant execute on function
  app.current_company_id(), app.member_role(), app.is_staff(), app.is_owner()
  to authenticated;
grant execute on all functions in schema app to service_role;

-- Shared triggers ---------------------------------------------------------------

create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Audit ------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  old_row jsonb,
  new_row jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log(table_name, row_id);

create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (company_id, table_name, row_id, action, actor_id, old_row, new_row)
  values (
    (v_row ->> 'company_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit();

-- Events and outbox -------------------------------------------------------------
-- Every side effect that leaves the database (SMS, email, later QuickBooks)
-- is written to the outbox in the same transaction as the change that caused
-- it, then delivered by the cron drain. A crash between "invoice final" and
-- "email sent" therefore retries the email instead of losing it.

create table public.domain_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}',
  actor_id uuid,
  occurred_at timestamptz not null default now()
);
create index domain_events_aggregate_idx on public.domain_events(aggregate_type, aggregate_id);

create table public.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  channel text not null check (channel in ('sms', 'email')),
  kind text not null,
  payload jsonb not null,
  dedupe_key text unique,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index outbox_due_idx on public.outbox_messages(run_after) where status in ('pending', 'failed');

create function app.emit(
  p_company_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.domain_events (company_id, aggregate_type, aggregate_id, event_type, payload, actor_id)
  values (p_company_id, p_aggregate_type, p_aggregate_id, p_event_type, p_payload, auth.uid());
$$;

create function app.enqueue(
  p_company_id uuid,
  p_channel text,
  p_kind text,
  p_payload jsonb,
  p_dedupe_key text default null,
  p_run_after timestamptz default now()
) returns void
language sql security definer set search_path = '' as $$
  insert into public.outbox_messages (company_id, channel, kind, payload, dedupe_key, run_after)
  values (p_company_id, p_channel, p_kind, p_payload, p_dedupe_key, p_run_after)
  on conflict (dedupe_key) do nothing;
$$;

-- SKIP LOCKED so overlapping cron invocations never deliver a message twice.
-- A message stuck in 'sending' for 10 minutes (worker died) is reclaimed.
create function public.claim_outbox(batch_size int default 20)
returns setof public.outbox_messages
language sql security definer set search_path = '' as $$
  update public.outbox_messages o
  set status = 'sending', locked_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from public.outbox_messages
    where (status in ('pending', 'failed') and run_after <= now())
       or (status = 'sending' and locked_at < now() - interval '10 minutes')
    order by run_after
    limit batch_size
    for update skip locked
  )
  returning o.*;
$$;

create function public.finish_outbox(p_id uuid, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.outbox_messages
  set status = case
        when p_error is null then 'sent'
        when attempts >= max_attempts then 'dead'
        else 'failed'
      end,
      sent_at = case when p_error is null then now() end,
      last_error = p_error,
      locked_at = null,
      -- Exponential backoff: 1, 4, 9, 16 minutes.
      run_after = case when p_error is null then run_after
                       else now() + make_interval(mins => attempts * attempts) end
  where id = p_id;
$$;

revoke execute on function public.claim_outbox(int), public.finish_outbox(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_outbox(int), public.finish_outbox(uuid, text) to service_role;

-- Document numbers --------------------------------------------------------------

create table public.number_sequences (
  company_id uuid not null references public.companies(id),
  kind text not null,
  last_value int not null default 0,
  primary key (company_id, kind)
);

create function app.next_number(p_company_id uuid, p_kind text) returns int
language sql security definer set search_path = '' as $$
  insert into public.number_sequences as s (company_id, kind, last_value)
  values (p_company_id, p_kind, 1001)
  on conflict (company_id, kind) do update set last_value = s.last_value + 1
  returning last_value;
$$;

-- RLS ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.brands enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.domain_events enable row level security;
alter table public.outbox_messages enable row level security;
alter table public.number_sequences enable row level security;

grant select on public.companies, public.brands, public.profiles, public.memberships to authenticated;
grant update on public.brands to authenticated;
grant update (full_name, phone, locale) on public.profiles to authenticated;
grant select on public.audit_log, public.domain_events to authenticated;
grant all on all tables in schema public to service_role;

create policy companies_member_read on public.companies for select to authenticated
  using (id = app.current_company_id());

create policy brands_member_read on public.brands for select to authenticated
  using (company_id = app.current_company_id());
create policy brands_owner_update on public.brands for update to authenticated
  using (company_id = app.current_company_id() and app.is_owner())
  with check (company_id = app.current_company_id());

-- Everyone reads their own profile; staff read the team's (names on the
-- schedule, driver phone numbers).
create policy profiles_read on public.profiles for select to authenticated
  using (
    user_id = auth.uid()
    or (app.is_staff() and user_id in (
      select m.user_id from public.memberships m where m.company_id = app.current_company_id()
    ))
  );
create policy profiles_self_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or (app.is_staff() and company_id = app.current_company_id()));

create policy audit_owner_read on public.audit_log for select to authenticated
  using (app.is_owner() and company_id = app.current_company_id());
create policy events_staff_read on public.domain_events for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
-- outbox_messages and number_sequences: service role only (no policies).
