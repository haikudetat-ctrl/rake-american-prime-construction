-- Adding several subcontract jobs at once, some already finished (Nov 13).
begin;
\ir support/fixtures.sql
select plan(31);

select id as company from public.companies where slug = 'american-prime' \gset

select tests.act_as('00000000-0000-0000-0000-000000000002');
insert into public.sub_contractors (company_id, name, cents_per_sq, pitch_tiers, min_job_cents)
values (:'company', 'Example Roofing GC', 9500, '[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]', 140000)
returning id as gc \gset
insert into public.sub_contractors (company_id, name, cents_per_sq) values (:'company', 'Other GC', 11000) returning id as other_gc \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Avery') returning id as avery \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Blake') returning id as blake \gset
insert into public.sub_settings (company_id, crew_cents_per_sq, crew_pitch_tiers)
values (:'company', 5000, '[{"from": 9, "cents": 500}, {"from": 11, "cents": 1000}]');
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'gc', '5" K-style gutter', 'ft', 650, 550) returning id as gutter \gset
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'gc', 'Plywood sheet', 'sheet', 2000, 0) returning id as plywood \gset
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'other_gc', 'Chimney flashing', 'each', 15000, 5000) returning id as flashing \gset
reset role;

select (current_date - 3)::text as past, (current_date + 30)::text as future \gset

-- One list, three kinds of job ------------------------------------------------------------
-- A roof from last week with plywood, a gutter-only job, and next week's job left open.
-- Roof: 20 sq × ($95 + $15 at 10/12) + 2 sheets × $20 = $2,240; crew 20 × ($50 + $5) = $1,100.
-- Gutters: 120 ft × $6.50 = $780; crew 120 × $5.50 = $660.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.add_sub_jobs(jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '12 Oak St.', 'worker_ids', jsonb_build_array(:'avery', :'blake'),
    'squares', 20, 'pitch', 10, 'items', jsonb_build_array(jsonb_build_object('item_id', :'plywood', 'qty', 2)),
    'expected_bill_cents', 224000, 'expected_pay_cents', 110000),
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '9 Gutter Lane', 'worker_ids', jsonb_build_array(:'blake'),
    'squares', 0, 'items', jsonb_build_array(jsonb_build_object('item_id', :'gutter', 'qty', 120)),
    'expected_bill_cents', 78000, 'expected_pay_cents', 66000),
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'future', 'address', '40 Next Week Rd', 'notes', 'two layers',
    'items', jsonb_build_array(jsonb_build_object('item_id', :'plywood', 'qty', 1)))
)) as result \gset
reset role;

select is(jsonb_array_length(:'result'::jsonb), 3, 'one result per job, in order');
select ok((:'result'::jsonb -> 0 ->> 'invoice_number') is not null and (:'result'::jsonb -> 1 ->> 'invoice_number') is not null,
  'the two finished jobs come back with invoice numbers');
select ok((:'result'::jsonb -> 2 ->> 'invoice_id') is null, 'the job without squares has no invoice');

select :'result'::jsonb -> 0 ->> 'job_id' as roof, :'result'::jsonb -> 1 ->> 'job_id' as gutters,
       :'result'::jsonb -> 2 ->> 'job_id' as later \gset
select is((select status from public.sub_jobs where id = :'roof'), 'done', 'the roof is closed');
select is((select bill_total_cents from public.sub_jobs where id = :'roof'), 224000, 'the roof bills squares, pitch tier and plywood');
select is((select pay_total_cents from public.sub_jobs where id = :'roof'), 110000, 'plywood adds nothing to crew pay');
select is((select sum(pay_cents)::int from public.sub_job_crew where job_id = :'roof'), 110000, 'crew pay is split across the crew');
select is((select total_cents from public.sub_invoices where job_id = :'roof' and status = 'open'), 224000, 'the invoice matches the job');
select is((select work_date from public.sub_jobs where id = :'roof'), current_date - 3, 'the job keeps the day it was worked');
select is((select count(*)::int from public.sub_job_extras where job_id = :'roof'), 1, 'the picked item is on the job');
select is((select status from public.sub_jobs where id = :'gutters'), 'done', 'a gutter-only job closes at 0 squares');
select is((select bill_total_cents from public.sub_jobs where id = :'gutters'), 78000, 'gutters bill from the list, no minimum');
select is((select status from public.sub_jobs where id = :'later'), 'scheduled', 'a job without squares stays scheduled');
select is((select notes from public.sub_jobs where id = :'later'), 'two layers', 'notes come through');
select is((select qty from public.sub_job_extras where job_id = :'later'), 1::numeric, 'an open job can carry line items too');

-- All or nothing -------------------------------------------------------------------------
select count(*)::int as before from public.sub_jobs \gset

select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '1 New St'),
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '1 new st')
)), 'P0001', null, 'the same address twice in one list is refused');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '2 Fine St'),
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '12 OAK ST')
)), 'P0001', null, 'a job already in Rake is refused, however the address is typed');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '3 Fine St', 'worker_ids', jsonb_build_array(:'avery'),
    'squares', 20, 'pitch', 10, 'expected_bill_cents', 219999, 'expected_pay_cents', 110000)
)), 'P0001', null, 'a total that differs from what was reviewed is refused');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'future', 'address', '4 Fine St', 'worker_ids', jsonb_build_array(:'avery'),
    'squares', 20, 'pitch', 10, 'expected_bill_cents', 220000, 'expected_pay_cents', 110000)
)), 'P0001', 'Job 1: it''s dated after today, so it can''t be closed yet', 'a job dated after today can''t be closed');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '5 Fine St', 'worker_ids', jsonb_build_array(:'avery'),
    'squares', 20, 'pitch', 10)
)), 'P0001', 'Job 1: review its totals before closing it', 'closing needs the totals that were reviewed');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '6 Fine St'),
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '7 Fine St',
    'squares', 20, 'pitch', 10, 'expected_bill_cents', 220000, 'expected_pay_cents', 110000)
)), 'P0001', 'Job 2: pick who worked the job first', 'the error names the job by its place in the list');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '8 Fine St',
    'items', jsonb_build_array(jsonb_build_object('item_id', :'flashing', 'qty', 1)))
)), 'P0001', 'Job 1: that item is on another contractor''s price list', 'one contractor''s prices never land on another''s job');
reset role;
select is((select count(*)::int from public.sub_jobs), :before, 'a refused list adds nothing at all');

-- The stale refusal carries the hint the app looks for.
select tests.act_as('00000000-0000-0000-0000-000000000002');
create function pg_temp.stale_hint(p jsonb) returns text language plpgsql as $$
declare v_hint text;
begin
  perform public.add_sub_jobs(p);
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end;
$$;
select is(pg_temp.stale_hint(jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '3 Fine St', 'worker_ids', jsonb_build_array(:'avery'),
    'squares', 20, 'pitch', 10, 'expected_bill_cents', 1, 'expected_pay_cents', 110000))), 'stale_review',
  'a changed total is flagged as a stale review');
reset role;

-- A cancelled job doesn't count as a duplicate.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.cancel_sub_job(:'later', 'rained out');
select lives_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'future', 'address', '40 Next Week Rd')
)), 'the same address can go back in after the first one was cancelled');
reset role;

-- Several items on an existing open job ---------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'gc', current_date, '50 Item Ave', null, array[:'avery']::uuid[]) as item_job \gset
select is(public.add_sub_job_price_items(:'item_job', jsonb_build_array(
  jsonb_build_object('item_id', :'gutter', 'qty', 60), jsonb_build_object('item_id', :'plywood', 'qty', 3))), 2,
  'two items go on in one go');
select throws_ok(format($$ select public.add_sub_job_price_items(%L, %L) $$, :'item_job', jsonb_build_array(
  jsonb_build_object('item_id', :'gutter', 'qty', 10), jsonb_build_object('item_id', :'gutter', 'qty', 5))), 'P0001',
  'an item is picked twice; put the total in one line', 'an item picked twice is refused');
select throws_ok(format($$ select public.add_sub_job_price_items(%L, %L) $$, :'item_job', jsonb_build_array(
  jsonb_build_object('item_id', :'plywood', 'qty', 1), jsonb_build_object('item_id', :'flashing', 'qty', 1))), 'P0001',
  'that item is on another contractor''s price list', 'one bad item adds none of them');
reset role;
select is((select count(*)::int from public.sub_job_extras where job_id = :'item_job'), 2, 'only the first good call landed');

-- Who can use it ----------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '9 Driver St'))), '42501', 'not authorized',
  'drivers can''t add subcontract jobs');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select throws_ok(format($$ select public.add_sub_jobs(%L) $$, jsonb_build_array(
  jsonb_build_object('contractor_id', :'gc', 'work_date', :'past', 'address', '9 Other Co St'))), 'P0002', 'Job 1: pick the contractor',
  'another company can''t add jobs for this company''s contractor');
reset role;

select * from finish();
rollback;
