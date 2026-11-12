-- Office sign-in codes: staff check, per-address throttle, service role only.
begin;
\ir support/fixtures.sql
select plan(9);

-- Drivers and crew sign in by phone, so an email on their account gets nothing.
update auth.users set email = 'driver@example.com' where id = '00000000-0000-0000-0000-000000000003';

select tests.act_as_service();
select is((select status from public.claim_staff_email_code('Owner@Example.com ')), 'send', 'an owner gets a code, any case');
select is((select company from public.claim_staff_email_code('office@example.com')), 'American Prime Construction', 'with their company name');
select is((select status from public.claim_staff_email_code('owner@example.com')), 'cooldown', 'a second code within a minute is refused');
select is((select status from public.claim_staff_email_code('nobody@example.com')), 'unknown', 'an address with no account sends nothing');
select is((select status from public.claim_staff_email_code('nobody@example.com')), 'cooldown', 'and is throttled like a real one');

select is((select status from public.claim_staff_email_code('driver@example.com')), 'unknown', 'drivers do not get email codes');

update public.auth_email_throttle
set last_sent_at = now() - interval '2 minutes', window_count = 5
where email_hash = encode(sha256(convert_to('owner@example.com', 'UTF8')), 'hex');
select is((select status from public.claim_staff_email_code('owner@example.com')), 'limit', 'five codes an hour per address');

select ok(not exists (select 1 from public.auth_email_throttle where email_hash like '%@%'), 'addresses are stored hashed');
reset role;

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.claim_staff_email_code('owner@example.com') $$, '42501', null, 'signed-in users cannot call it');
reset role;

select * from finish();
rollback;
