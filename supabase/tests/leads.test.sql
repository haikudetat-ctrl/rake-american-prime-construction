-- Roofing leads: public link, pipeline moves, notes, numbers, and who can see them.
begin;
\ir support/fixtures.sql
select plan(21);

-- Public link -------------------------------------------------------------------------
select tests.act_as_service();
select public.submit_lead_request('roof', 'Pat Homeowner', '+15551230000', null, '12 Ocean Ave, Ventnor, NJ', 'Ventnor',
  null, null, null, 'replacement', 'Leaking at the chimney', 'You may call or text me.', 'hash-1') as lead1 \gset
select throws_ok($$ select public.submit_lead_request('dumpster', 'X', '+15551230001', null, 'a', null,
  null, null, null, 'repair', null, null, 'hash-2') $$, 'P0002', null, 'a dumpster link cannot take a roofing lead');
select throws_ok($$ select public.submit_rental_request('roof', 'X', null, '+15551230001', null, '12 Main St',
  null, null, null, null, current_date + 1, null, null, 'hash-3') $$, 'P0002', null, 'the roofing link cannot take a dumpster request');
reset role;

select is((select stage from public.leads where id = :'lead1'), 'new', 'link lead starts as new');
select isnt((select contact_consent_at from public.leads where id = :'lead1'), null, 'consent time recorded');
select is((select count(*)::int from public.outbox_messages where kind = 'lead_received'), 1,
  'owner with a phone gets a new-lead text (office has none)');
select is((select count(*)::int from public.lead_events where lead_id = :'lead1' and kind = 'created'), 1, 'created event logged');

-- Rate limit
select tests.act_as_service();
select public.submit_lead_request('roof', 'Bot', '+15551239999', null, 'a st', null, null, null, null, 'other', null, null, 'spam')
from generate_series(1, 5);
select throws_ok($$ select public.submit_lead_request('roof', 'Bot', '+15551239999', null, 'a st', null, null, null, null,
  'other', null, null, 'spam') $$, 'P0001', null, 'sixth lead in an hour from one sender is refused');
reset role;

-- Who sees leads -----------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.leads), 0, 'crew sees no leads');
select throws_ok(format($$ select public.move_lead(%L, 'contacted') $$, :'lead1'), '42501', null, 'crew cannot move leads');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.leads), 0, 'drivers see no leads');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.leads), 0, 'another company sees none');
reset role;
select tests.act_as_anon();
select throws_ok($$ select * from public.leads $$, '42501', null, 'anonymous visitors cannot read leads');
reset role;

-- Pipeline -----------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok(format($$ select public.move_lead(%L, 'contacted', null, null, 'Left a voicemail') $$, :'lead1'),
  'office moves a lead to contacted');
select throws_ok(format($$ select public.move_lead(%L, 'appointment') $$, :'lead1'), 'P0001',
  'pick the appointment date and time', 'an appointment needs a time');
select lives_ok(format($$ select public.move_lead(%L, 'appointment', now() + interval '2 days') $$, :'lead1'),
  'appointment booked');
select throws_ok(format($$ select public.move_lead(%L, 'lost') $$, :'lead1'), 'P0001',
  'say why the lead was lost', 'losing a lead needs a reason');
select lives_ok(format($$ select public.move_lead(%L, 'lost', null, 'Went with a cheaper bid') $$, :'lead1'), 'lead lost');
select public.add_lead_note(:'lead1', 'Call back in spring');
select public.create_lead('Walk-in', '+15551230005', null, '9 Bay Rd', 'gutters', null, 'phone') as lead2 \gset
reset role;

select is((select lost_reason from public.leads where id = :'lead1'), 'Went with a cheaper bid', 'reason kept on the lead');
select is((select count(*)::int from public.lead_events where lead_id = :'lead1'), 5,
  'created, three moves and a note on the timeline');

select tests.act_as('00000000-0000-0000-0000-000000000001');
select is((public.lead_numbers(current_date - 30) -> 'by_stage' ->> 'new')::int, 6, 'six new leads open');
select is((public.lead_numbers(current_date - 30) ->> 'lost')::int, 1, 'one lost this period');
reset role;

select * from finish();
rollback;
