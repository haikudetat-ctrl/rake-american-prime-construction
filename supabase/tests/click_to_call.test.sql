-- Calling out from the business number (Nov 23): outbound calls close once.
begin;
\ir support/fixtures.sql
select plan(5);

select id as company from public.companies where slug = 'american-prime' \gset

insert into public.phone_calls (company_id, call_sid, from_number, to_number, direction)
values (:'company', 'CA-out-1', '+16095550123', '+16095550100', 'out'),
       (:'company', 'CA-out-2', '+16095550124', '+16095550100', 'out'),
       (:'company', 'CA-in-1', '+16095550125', '+16095550100', 'in');

select is((select direction from public.phone_calls where call_sid = 'CA-in-1'), 'in', 'calls are inbound unless marked');

select public.finish_outbound_call('CA-out-1', true, 95);
select is((select status || ':' || duration_seconds from public.phone_calls where call_sid = 'CA-out-1'), 'answered:95',
  'a connected call out is closed as answered with its length');
select public.finish_outbound_call('CA-out-1', false, 0);
select is((select status from public.phone_calls where call_sid = 'CA-out-1'), 'answered',
  'the end-of-call callback does not undo a call that connected');

select public.finish_outbound_call('CA-out-2', false, 0);
select is((select status from public.phone_calls where call_sid = 'CA-out-2'), 'missed', 'a call out that never connected is closed as such');

select public.finish_outbound_call('CA-in-1', false, 0);
select is((select status from public.phone_calls where call_sid = 'CA-in-1'), 'ringing', 'it never touches an inbound call');

select * from finish();
rollback;
