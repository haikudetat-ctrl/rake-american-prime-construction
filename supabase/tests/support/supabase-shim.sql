-- Minimal stand-in for the parts of a Supabase database the migrations touch,
-- so they can be applied and tested against a plain Postgres where Docker (and
-- therefore `supabase start`) is unavailable. Never applied to a real project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  created_at timestamptz not null default now()
);

-- Same contract as Supabase: the caller's identity comes from the JWT claims
-- PostgREST sets per request. Tests set them with `set_config`.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
