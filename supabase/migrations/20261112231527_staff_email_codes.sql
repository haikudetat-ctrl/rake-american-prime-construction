-- Office sign-in codes are emailed by the app through Resend, not by Supabase
-- Auth's built-in mailer (which only reaches the Supabase team and allows two
-- emails an hour). Supabase still issues and checks the code; the app only
-- delivers it. This file is the gate in front of that send.
--
-- Every address is throttled the same way whether or not it has an account,
-- so the sign-in page answers identically for both. Addresses are stored only
-- as sha256 hashes.

create table public.auth_email_throttle (
  email_hash text primary key,
  last_sent_at timestamptz not null,
  window_started_at timestamptz not null,
  window_count int not null
);

alter table public.auth_email_throttle enable row level security;
revoke all on public.auth_email_throttle from anon, authenticated;
grant all on public.auth_email_throttle to service_role;

-- Returns one row:
--   status  'send'     an active owner or office member; email them a code
--           'unknown'  no such staff member; say "sent" and send nothing
--           'cooldown' a code went to this address under a minute ago
--           'limit'    five codes this hour already
--   company the member's company name (only when status = 'send')
create function public.claim_staff_email_code(p_email text)
returns table (status text, company text)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_hash text := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  v_row public.auth_email_throttle;
  v_company text;
begin
  delete from public.auth_email_throttle where last_sent_at < now() - interval '1 day';

  insert into public.auth_email_throttle (email_hash, last_sent_at, window_started_at, window_count)
  values (v_hash, '-infinity', now(), 0)
  on conflict (email_hash) do nothing;

  select * into v_row from public.auth_email_throttle t where t.email_hash = v_hash for update;

  if v_row.last_sent_at > now() - interval '60 seconds' then
    return query select 'cooldown'::text, null::text;
    return;
  end if;
  if v_row.window_started_at > now() - interval '1 hour' and v_row.window_count >= 5 then
    return query select 'limit'::text, null::text;
    return;
  end if;

  update public.auth_email_throttle t
  set last_sent_at = now(),
      window_started_at = case when t.window_started_at <= now() - interval '1 hour' then now() else t.window_started_at end,
      window_count = case when t.window_started_at <= now() - interval '1 hour' then 1 else t.window_count + 1 end
  where t.email_hash = v_hash;

  select c.name into v_company
  from auth.users u
  join public.memberships m on m.user_id = u.id and m.is_active and m.role in ('owner', 'office')
  join public.companies c on c.id = m.company_id
  where lower(u.email) = v_email
  order by m.created_at
  limit 1;

  if v_company is null then
    return query select 'unknown'::text, null::text;
  else
    return query select 'send'::text, v_company;
  end if;
end;
$$;

revoke execute on function public.claim_staff_email_code(text) from public, anon, authenticated;
grant execute on function public.claim_staff_email_code(text) to service_role;
