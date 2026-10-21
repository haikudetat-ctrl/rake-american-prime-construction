-- Shared fixture for the pgTAP suites. Included inside each suite's
-- transaction, so everything here rolls back with the test.
--
-- Users (fixed ids so assertions can name them):
--   ...0001 owner      ...0002 office     ...0003 driver A
--   ...0004 driver B   ...0005 crew       ...0009 owner of another company

insert into auth.users (id, email, phone) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com', '+15550000001'),
  ('00000000-0000-0000-0000-000000000002', 'office@example.com', '+15550000002'),
  ('00000000-0000-0000-0000-000000000003', null, '+15550000003'),
  ('00000000-0000-0000-0000-000000000004', null, '+15550000004'),
  ('00000000-0000-0000-0000-000000000005', null, '+15550000005'),
  ('00000000-0000-0000-0000-000000000009', 'other@example.com', null);

insert into public.profiles (user_id, full_name, phone) values
  ('00000000-0000-0000-0000-000000000001', 'Owner', '+15550000001'),
  ('00000000-0000-0000-0000-000000000002', 'Office', null),
  ('00000000-0000-0000-0000-000000000003', 'Driver A', '+15550000003'),
  ('00000000-0000-0000-0000-000000000004', 'Driver B', '+15550000004'),
  ('00000000-0000-0000-0000-000000000005', 'Crew', null);

insert into public.memberships (user_id, company_id, role)
select u.id, c.id, u.role
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'office'),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'driver'),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'driver'),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'crew')
) as u(id, role)
cross join public.companies c where c.slug = 'american-prime';

-- A second company, to prove isolation.
with other as (
  insert into public.companies (slug, name) values ('other-co', 'Other Co') returning id
)
insert into public.memberships (user_id, company_id, role)
select '00000000-0000-0000-0000-000000000009', id, 'owner' from other;
insert into public.customers (company_id, name)
select id, 'Other Co customer' from public.companies where slug = 'other-co';

insert into public.cans (company_id, label, size_yards, home_yard_id)
select c.id, l.label, 20, (select id from public.yards y where y.company_id = c.id and y.name = 'Home yard')
from public.companies c, (values ('C1'), ('C2'), ('C3')) as l(label)
where c.slug = 'american-prime';

insert into public.landfills (company_id, name)
select id, 'County landfill' from public.companies where slug = 'american-prime';

-- Act-as helpers. `act_as` switches to the authenticated role with the given
-- user's JWT subject; `act_as_service` is the server's service role.
create schema tests;
grant usage on schema tests to authenticated, service_role, anon;

create function tests.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end;
$$;

create function tests.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
end;
$$;

create function tests.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end;
$$;

-- A drop or pickup needs at least one photo, uploaded under the company's
-- folder. Each call returns a fresh path (paths are unique).
create function tests.photo() returns text[] language sql security definer set search_path = '' as $$
  select array[(select id::text from public.companies where slug = 'american-prime') || '/test-' || gen_random_uuid() || '.jpg']
$$;

grant execute on all functions in schema tests to authenticated, service_role, anon;
