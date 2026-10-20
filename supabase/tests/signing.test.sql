-- Sending, signing, versions and roofing jobs.
begin;
\ir support/fixtures.sql
select plan(24);

select id as company from public.companies where slug = 'american-prime' \gset
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_lead('Pat', '+16095550100', 'pat@example.com', '12 Ocean Ave', 'replacement', null, 'office') as lead \gset
reset role;

select tests.act_as_service();
select public.seed_catalog(:'company', '{"materials":[],"systems":[],"labor":{}}') as catalog \gset
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.publish_catalog('{"materials":[],"systems":[],"labor":{}}', false) as real_catalog \gset
reset role;

-- A draft priced from placeholders can't be sent.
select tests.act_as_service();
select public.save_proposal(:'company', '00000000-0000-0000-0000-000000000002', :'lead', null, :'catalog', null, '{"squares":30}', '{}',
  '[{"systemId":"good","name":"HDZ","priceCents":1500000},{"systemId":"best","name":"Sequoia","priceCents":2100000,"overrideCents":2000000}]',
  '[{"addonId":"gutters","name":"Gutters","qty":150,"unitLabel":"ft","priceCents":118000}]', '[]', '{}') as placeholder \gset
select throws_ok(format($$ select public.send_proposal(%L, %L, %L, repeat('a', 43), 'h', 'Terms', 30, true, true) $$,
  :'company', '00000000-0000-0000-0000-000000000002', :'placeholder'), 'P0001', null, 'placeholder prices cannot be sent');

select public.save_proposal(:'company', '00000000-0000-0000-0000-000000000002', :'lead', null, :'real_catalog', null, '{"squares":30}', '{}',
  '[{"systemId":"good","name":"HDZ","priceCents":1500000},{"systemId":"best","name":"Sequoia","priceCents":2100000,"overrideCents":2000000}]',
  '[{"addonId":"gutters","name":"Gutters","qty":150,"unitLabel":"ft","priceCents":118000}]', '[]', '{}') as p1 \gset
select lives_ok(format($$ select public.send_proposal(%L, %L, %L, repeat('t', 43), 'hash-1', 'Terms v1', 30, true, true) $$,
  :'company', '00000000-0000-0000-0000-000000000002', :'p1'), 'a real-priced draft is sent');
select throws_ok(format($$ select public.send_proposal(%L, %L, %L, repeat('u', 43), 'h', 'Terms', 30, true, false) $$,
  :'company', '00000000-0000-0000-0000-000000000002', :'p1'), 'P0001', 'this proposal was already sent', 'sent once only');
reset role;

select is((select status from public.proposals where id = :'p1'), 'sent', 'proposal is sent');
select is((select stage from public.leads where id = :'lead'), 'proposal_sent', 'lead moved to proposal sent');
select is((select count(*)::int from public.outbox_messages where kind = 'proposal_link'), 2, 'link queued by text and email');

-- Office can't touch the homeowner functions.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.record_proposal_view('x') $$, '42501', null, 'view is recorded by the server only');
reset role;

-- Homeowner opens and signs.
select tests.act_as_service();
select public.record_proposal_view(repeat('t', 43));
select public.record_proposal_view(repeat('t', 43));
select throws_ok($$ select public.sign_proposal(repeat('t', 43), 'good', '{}', 'Pat Homeowner', 'sig.png', '1.2.3.4', 'UA', 'stale') $$,
  'P0001', 'this proposal changed since the page was opened; reload it', 'a stale page cannot sign');
select throws_ok($$ select public.sign_proposal(repeat('t', 43), 'nope', '{}', 'Pat Homeowner', 'sig.png', '1.2.3.4', 'UA', 'hash-1') $$,
  'P0001', 'choose one of the options', 'unknown option refused');
select throws_ok($$ select public.sign_proposal(repeat('t', 43), 'best', '{roof-coating}', 'Pat Homeowner', 'sig.png', '1.2.3.4', 'UA', 'hash-1') $$,
  'P0001', 'an add-on is not on this proposal', 'unknown add-on refused');
select public.sign_proposal(repeat('t', 43), 'best', '{gutters}', 'Pat Homeowner', 'sig.png', '1.2.3.4', 'UA', 'hash-1') as job \gset
select throws_ok($$ select public.sign_proposal(repeat('t', 43), 'good', '{}', 'Pat Homeowner', 'sig.png', '1.2.3.4', 'UA', 'hash-1') $$,
  'P0001', 'this proposal is already signed', 'signs once');
reset role;

select is((select count(*)::int from public.lead_events where body like '%opened by the homeowner'), 1, 'first view logged once');
select is((select total_cents from public.proposal_signatures where proposal_id = :'p1'), 2118000,
  'total uses the owner''s price plus the chosen add-on, computed in the database');
select is((select stage from public.leads where id = :'lead'), 'won', 'lead won');
select is((select system_name from public.roofing_jobs where id = :'job'), 'Sequoia', 'job created for the chosen system');
select is((select count(*)::int from public.outbox_messages where kind in ('proposal_signed')), 2,
  'owner told (text) and homeowner emailed a copy');

-- Versions
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.revise_proposal(%L) $$, :'p1'), 'P0001', 'a signed proposal cannot be changed',
  'signed proposals are final');
reset role;

-- Jobs: crew sees their own, without prices.
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.crew_jobs()), 0, 'crew sees nothing until assigned');
select throws_ok(format($$ select public.schedule_roofing_job(%L, current_date + 3, '{}', null) $$, :'job'), '42501', null,
  'crew cannot schedule');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.schedule_roofing_job(:'job', current_date + 3, '{00000000-0000-0000-0000-000000000005}', 'Gate code 1234');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select system_name from public.crew_jobs()), 'Sequoia', 'assigned crew sees the job');
select is((select count(*)::int from public.roofing_jobs), 0, 'crew cannot read the jobs table (it has the price)');
select lives_ok(format($$ select public.set_roofing_job_status(%L, 'in_progress') $$, :'job'), 'crew starts the job');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000004');
select throws_ok(format($$ select public.set_roofing_job_status(%L, 'done') $$, :'job'), '42501', null, 'someone else''s job is refused');
reset role;
select isnt((select started_at from public.roofing_jobs where id = :'job'), null, 'start time recorded');

select * from finish();
rollback;
