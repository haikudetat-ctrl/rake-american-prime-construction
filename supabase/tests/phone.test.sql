-- Business phone: calls, voicemail, texts, opt-outs, and who can see them.
begin;
\ir support/fixtures.sql
select plan(20);

insert into public.customers (id, company_id, name, phone)
select '00000000-0000-0000-0000-0000000000c1', id, 'Shore Roofing', '+16095550111'
from public.companies where slug = 'american-prime';

select tests.act_as_service();
-- A stranger calls; nobody answers.
select public.record_inbound_call('CA1', '+16095550100', '+16095559999', false);
select public.record_inbound_call('CA1', '+16095550100', '+16095559999', false); -- Twilio retry
select public.finish_call('CA1', false, 0);
select public.attach_voicemail('CA1', 'RE1', 'https://api.twilio.com/rec/RE1', 14);
select public.attach_voicemail('CA1', 'RE1', 'https://api.twilio.com/rec/RE1', 14); -- retry
-- The dumpster customer calls and someone picks up.
select public.record_inbound_call('CA2', '+16095550111', '+16095559999', false);
select public.finish_call('CA2', true, 95);
-- The stranger texts afterwards, then a new number texts.
select public.receive_text('SM1', '+16095550100', '+16095559999', 'Did you get my message?', '{}');
select public.receive_text('SM1', '+16095550100', '+16095559999', 'Did you get my message?', '{}'); -- retry
select public.receive_text('SM2', '+16095550122', '+16095559999', 'Need a roof quote', '{}');
reset role;

select is((select count(*)::int from public.phone_calls), 2, 'one row per call, retries ignored');
select is((select status from public.phone_calls where call_sid = 'CA1'), 'voicemail', 'missed call with voicemail');
select is((select count(*)::int from public.leads where phone = '+16095550100'), 1, 'the stranger became one lead');
select is((select source from public.leads where phone = '+16095550100'), 'phone', 'lead source is phone');
select is((select lead_id from public.messages where twilio_sid = 'SM1'),
  (select id from public.leads where phone = '+16095550100'), 'their later text lands on the same lead');
select is((select customer_id from public.phone_calls where call_sid = 'CA2'), '00000000-0000-0000-0000-0000000000c1'::uuid,
  'a known dumpster customer is matched, not made a lead');
select is((select count(*)::int from public.leads where phone = '+16095550111'), 0, 'no lead for the customer');
select is((select source from public.leads where phone = '+16095550122'), 'text', 'a new texter becomes a text lead');
select is((select count(*)::int from public.messages), 2, 'one row per text, retries ignored');
select is((select count(*)::int from public.outbox_messages where kind = 'voicemail_received'), 1, 'owner told about the voicemail once');
select is((select count(*)::int from public.outbox_messages where kind = 'text_received'), 2, 'owner told about each text');

-- Office reads and replies ------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.messages where direction = 'in' and read_at is null), 2, 'office sees unread texts');
select public.mark_thread_read('+16095550100');
select lives_ok($$ select public.send_text('+16095550100', 'Yes! We''ll call you at 3.') $$, 'office replies');
select throws_ok($$ select public.send_text('5550100', 'hi') $$, 'P0001', 'not a US mobile number', 'bad numbers refused');
reset role;
select is((select count(*)::int from public.messages where phone = '+16095550100' and direction = 'in' and read_at is null), 0,
  'thread marked read');
select is((select count(*)::int from public.outbox_messages where kind = 'reply'), 1, 'reply queued for the outbox');

-- Opt-out ---------------------------------------------------------------------------
select tests.act_as_service();
select public.receive_text('SM3', '+16095550100', '+16095559999', 'stop', '{}');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.send_text('+16095550100', 'Following up') $$, 'P0001', null, 'no texts after STOP');
reset role;
select tests.act_as_service();
select public.receive_text('SM4', '+16095550100', '+16095559999', 'START', '{}');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.send_text('+16095550100', 'Welcome back') $$, 'texting allowed again after START');
reset role;

-- Visibility ------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.messages) + (select count(*)::int from public.phone_calls), 0, 'crew sees no calls or texts');
select throws_ok($$ select public.send_text('+16095550100', 'hi') $$, '42501', null, 'crew cannot text from the business number');
reset role;

select * from finish();
rollback;
