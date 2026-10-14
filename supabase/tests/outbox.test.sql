-- Outbox delivery: claim by channel, back off on failure, dead after max attempts.
begin;
\ir support/fixtures.sql
select plan(8);

insert into public.outbox_messages (company_id, channel, kind, payload, dedupe_key)
select id, 'sms', 'request_received', '{}', 'k-sms' from public.companies where slug = 'american-prime';
insert into public.outbox_messages (company_id, channel, kind, payload, dedupe_key)
select id, 'email', 'statement_issued', '{}', 'k-email' from public.companies where slug = 'american-prime';

select tests.act_as_service();
select is((select count(*)::int from public.claim_outbox(10, array['email'])), 1, 'claims only configured channels');
select is((select status from public.outbox_messages where dedupe_key = 'k-sms'), 'pending', 'sms waits while unconfigured');
select is((select count(*)::int from public.claim_outbox(10, array['email'])), 0, 'a claimed message is not claimed twice');

select public.finish_outbox((select id from public.outbox_messages where dedupe_key = 'k-email'), 'boom');
select is((select status from public.outbox_messages where dedupe_key = 'k-email'), 'failed', 'failure is retried');
select ok((select run_after > now() from public.outbox_messages where dedupe_key = 'k-email'), 'with backoff');

update public.outbox_messages set attempts = max_attempts, run_after = now() where dedupe_key = 'k-email';
select public.finish_outbox((select id from public.outbox_messages where dedupe_key = 'k-email'), 'boom');
select is((select status from public.outbox_messages where dedupe_key = 'k-email'), 'dead', 'gives up after max attempts');
reset role;

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.claim_outbox(10, array['sms']) $$, '42501', null, 'owners cannot drain the outbox');
select throws_ok($$ select count(*) from public.outbox_messages $$, '42501', null, 'or read it');
reset role;

select * from finish();
rollback;
