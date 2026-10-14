-- QuickBooks Online connection (one per company).
--
-- Tokens are encrypted by the app (AES-256-GCM, key in QBO_TOKEN_KEY) before
-- they reach this table, and the table has RLS with no policies and no grants
-- to signed-in users: only the server's service role can read it. A database
-- dump or a leaked publishable key therefore yields nothing usable.

create table public.qbo_connections (
  company_id uuid primary key references public.companies(id),
  environment text not null check (environment in ('sandbox', 'production')),
  realm_id text not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  -- Intuit rotates refresh tokens; this is the rolling expiry of the newest one.
  refresh_expires_at timestamptz,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz
);

alter table public.qbo_connections enable row level security;
revoke all on public.qbo_connections from anon, authenticated;
grant all on public.qbo_connections to service_role;
