-- Subcontracting rates, round 2: pitch tiers, the minimum job charge, the
-- contractor price list and gutter-only jobs (Nov 11 call).
begin;
\ir support/fixtures.sql
select plan(32);

select id as company from public.companies where slug = 'american-prime' \gset

-- Tier math ------------------------------------------------------------------------------
select is(app.sub_tier_cents('[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]', 8), 0, 'no extra below the first tier');
select is(app.sub_tier_cents('[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]', 10), 1500, '10/12 is still the 9/12 tier');
select is(app.sub_tier_cents('[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]', 12), 2000, '12/12 is the 11/12 tier');
select is(app.sub_tier_cents('[]', 12), 0, 'no tiers, no extra');
-- The old $5 step from 9/12 converts exactly, all the way to 24/12.
select ok(
  (select bool_and(app.sub_tier_cents(app.linear_pitch_tiers(9, 500), p) = app.sub_pitch_cents(9, 500, p)) from generate_series(0, 24) as p),
  'a step rate converts to tiers without changing any amount');
select is(app.linear_pitch_tiers(9, 0), '[]'::jsonb, 'a $0 step is no tiers');
select ok(not app.valid_pitch_tiers('[{"from": 11, "cents": 2000}, {"from": 9, "cents": 1500}]'), 'tiers must go up in pitch');
select ok(not app.valid_pitch_tiers('[{"from": 0, "cents": 100}]'), 'a tier starts at 1/12 or above');
select ok(not app.valid_pitch_tiers('[{"from": 9, "cents": 15.5}]'), 'whole cents only');
select ok(not app.valid_pitch_tiers('{"from": 9}'), 'tiers are a list');

-- Setup as the office ---------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
insert into public.sub_contractors (company_id, name, billing_email, cents_per_sq, pitch_tiers, min_job_cents)
values (:'company', 'Example Roofing GC', 'ap@example.com', 12000, '[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]', 140000)
returning id as gc \gset
insert into public.sub_contractors (company_id, name, cents_per_sq) values (:'company', 'Example Gutter GC', 9500) returning id as gutter_gc \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Avery') returning id as avery \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Blake') returning id as blake \gset
insert into public.sub_settings (company_id, crew_cents_per_sq, crew_pitch_tiers)
values (:'company', 5000, '[{"from": 9, "cents": 500}, {"from": 11, "cents": 1000}]');
select throws_ok(
  format($$ update public.sub_contractors set pitch_tiers = '[{"from": 12, "cents": 1}, {"from": 12, "cents": 2}]' where id = %L $$, :'gc'),
  '23514', null, 'the database refuses a malformed tier list');
select is((select pitch_tiers from public.sub_contractors where id = :'gutter_gc'), app.linear_pitch_tiers(9, 500),
  'a contractor added without tiers gets the old default steps');

insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'gutter_gc', '5" K-style gutter', 'ft', 650, 550) returning id as gutter_item \gset
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'gutter_gc', '5" miter', 'each', 1650, 1350) returning id as miter_item \gset
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'gc', 'Plywood sheet', 'sheet', 2000, 0) returning id as plywood_item \gset
reset role;

-- A steep roof: 20 sq at 10/12 bills the 9/12 tier, not two steps. ------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'gc', current_date, '1 Steep Road', null, array[:'avery', :'blake']::uuid[]) as steep \gset
select public.complete_sub_job(:'steep', 20, 10) as steep_invoice \gset
reset role;
select is((select bill_total_cents from public.sub_jobs where id = :'steep'), 270000, '20 sq × ($120 + $15) at 10/12');
select is((select bill_pitch_cents from public.sub_jobs where id = :'steep'), 1500, 'the tier is frozen on the job');
select is((select pay_total_cents from public.sub_jobs where id = :'steep'), 110000, 'crew: 20 sq × ($50 + $5 crew tier)');
select is((select bill_minimum_cents from public.sub_jobs where id = :'steep'), 0, 'no minimum top-up on a big roof');

-- A small roof: 8 sq at 6/12 is $960 by the square, so it bills the $1,400 floor. ---------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'gc', current_date, '2 Small Road', null, array[:'avery']::uuid[]) as small \gset
select public.add_sub_job_price_item(:'small', :'plywood_item', 2);
select public.complete_sub_job(:'small', 8, 6) as small_invoice \gset
reset role;
-- 8 × $120 + 2 sheets × $20 = $1,000; topped up by $400.
select is((select bill_total_cents from public.sub_jobs where id = :'small'), 140000, 'a small roof bills the minimum');
select is((select bill_minimum_cents from public.sub_jobs where id = :'small'), 40000, 'the top-up is frozen as its own amount');
select is((select total_cents from public.sub_invoices where id = :'small_invoice'), 140000, 'the invoice carries the minimum');
select is((select pay_total_cents from public.sub_jobs where id = :'small'), 40000, 'the minimum never changes crew pay');
select is((select unit from public.sub_job_extras where job_id = :'small'), 'sheet', 'a price-list extra keeps its unit');

-- Reopening clears the frozen top-up.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.reopen_sub_job(:'small', 'wrong squares');
reset role;
select is((select bill_minimum_cents from public.sub_jobs where id = :'small'), 0, 'reopening clears the top-up');

-- A gutter-only job: 0 squares, priced from the contractor's list. -------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'gutter_gc', current_date, '3 Gutter Lane', null, array[:'blake']::uuid[]) as gutters \gset
select throws_ok(format($$ select public.add_sub_job_price_item(%L, %L, 10) $$, :'gutters', :'plywood_item'), 'P0001',
  'that item is on another contractor''s price list', 'one contractor''s prices never land on another''s job');
select throws_ok(format($$ select public.add_sub_job_price_item(%L, %L, 0) $$, :'gutters', :'gutter_item'), 'P0001',
  'enter how many', 'a price-list line needs a quantity');
select public.add_sub_job_price_item(:'gutters', :'gutter_item', 120);
select public.add_sub_job_price_item(:'gutters', :'miter_item', 4);
select public.complete_sub_job(:'gutters', 0, 0) as gutter_invoice \gset
reset role;
-- 120 ft × $6.50 + 4 × $16.50 = $846; crew 120 × $5.50 + 4 × $13.50 = $714.
select is((select bill_total_cents from public.sub_jobs where id = :'gutters'), 84600, 'gutters bill by the foot and miters each');
select is((select pay_total_cents from public.sub_jobs where id = :'gutters'), 71400, 'crew pay comes from the list too');
select is((select squares from public.sub_jobs where id = :'gutters'), 0::numeric, 'the job closes at 0 squares');

-- Fingerprint covers the new rates. --------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'gc', current_date, '4 Review Road', null, array[:'avery']::uuid[]) as review_job \gset
select public.sub_job_closeout_fingerprint(:'review_job') as fp \gset
update public.sub_contractors set pitch_tiers = '[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2500}]' where id = :'gc';
select throws_ok(format($$ select public.complete_sub_job(%L, 20, 12, %L) $$, :'review_job', :'fp'), 'P0001',
  'work changed during review', 'a tier change during review blocks the close');
select public.sub_job_closeout_fingerprint(:'review_job') as fp \gset
update public.sub_contractors set min_job_cents = 150000 where id = :'gc';
select throws_ok(format($$ select public.complete_sub_job(%L, 20, 12, %L) $$, :'review_job', :'fp'), 'P0001',
  'work changed during review', 'a minimum change during review blocks the close');
reset role;

-- Who sees the price list. ------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.sub_price_items), 0, 'drivers see no price list');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.sub_price_items), 0, 'another company sees none of it');
select throws_ok(format($$ select public.add_sub_job_price_item(%L, %L, 1) $$, :'review_job', :'plywood_item'), 'P0002', 'job not found',
  'another company can''t add to the job');
reset role;

select * from finish();
rollback;
