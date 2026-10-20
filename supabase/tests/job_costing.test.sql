-- Job costing: costs, stock at average cost, own equipment, payments, cash view.
begin;
\ir support/fixtures.sql
select plan(21);

select id as company from public.companies where slug = 'american-prime' \gset
-- A signed $20,000 job, created directly for the test.
insert into public.leads (id, company_id, brand_id, source, name, phone)
select '00000000-0000-0000-0000-0000000000e1', :'company', b.id, 'office', 'Pat', '+16095550100'
from public.brands b where b.company_id = :'company' and b.kind = 'roofing';
insert into public.catalog_versions (id, company_id, version, data, needs_confirmation, is_active)
values ('00000000-0000-0000-0000-0000000000e2', :'company', 1, '{}', false, true);
insert into public.proposals (id, company_id, lead_id, number, catalog_version_id, needs_confirmation, measurement, inputs, options, addons)
values ('00000000-0000-0000-0000-0000000000e3', :'company', '00000000-0000-0000-0000-0000000000e1', 5001,
        '00000000-0000-0000-0000-0000000000e2', false, '{}', '{}', '[]', '[]');
insert into public.roofing_jobs (id, company_id, lead_id, proposal_id, customer_name, system_name, scope, total_cents)
values ('00000000-0000-0000-0000-0000000000e4', :'company', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000e3', 'Pat', 'GAF Timberline HDZ', '{}', 2000000);
\set job '00000000-0000-0000-0000-0000000000e4'

select tests.act_as('00000000-0000-0000-0000-000000000002');
-- Bulk underlayment: 10 rolls at $180, then 10 at $200 → average $190.
select public.create_stock_item('Synthetic underlayment', 'roll') as roll \gset
select public.stock_buy(:'roll', 10, 180000, 'ABC Supply', 'INV-1', current_date);
select public.stock_buy(:'roll', 10, 200000, 'ABC Supply', 'INV-2', current_date);
reset role;
select is((select avg_cost_cents from public.stock_items where id = :'roll'), 19000.0000::numeric, 'average cost across buys');
select is((select on_hand from public.stock_items where id = :'roll'), 20.00::numeric, '20 rolls on the shelf');

select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.stock_pull(:'roll', :'job', 4) as pull \gset
select throws_ok(format($$ select public.stock_pull(%L, %L, 50) $$, :'roll', :'job'), 'P0001', null, 'cannot pull more than is on hand');
select public.stock_pull(:'roll', :'job', -1);
select public.add_job_cost(:'job', 'crew', 'Tear-off and install crew', 270000, 30, 9000, 'Crew A', null, current_date);
select public.add_job_cost(:'job', 'materials', 'Shingles delivered', 396000, null, null, 'ABC Supply', 'INV-77', current_date);
select public.add_own_equipment(:'job', 'dumpster', 1);
select public.add_own_equipment(:'job', 'gutters', 150);
select throws_ok(format($$ select public.add_job_cost(%L, 'stock', 'x', 1, null, null, null, null, null) $$, :'job'), 'P0001', null,
  'stock goes through the stock functions');
reset role;

select is((select amount_cents from public.job_costs where id = :'pull'), 76000, '4 rolls charged at $190');
select is((select on_hand from public.stock_items where id = :'roll'), 17.00::numeric, '4 out, 1 back');
select is((select sum(amount_cents)::int from public.job_costs where job_id = :'job' and voided_at is null),
  76000 - 19000 + 270000 + 396000 + 25000 + 37500, 'job cost adds up');
select is((select amount_cents from public.job_costs where job_id = :'job' and kind = 'gutters'), 37500, 'our gutters at $2.50/ft');
select is((select count(*)::int from public.job_costs where job_id = :'job' and is_cash), 2, 'only crew and bills are new cash');

-- Voiding a pull puts the rolls back.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.void_job_cost(:'pull', 'pulled for the wrong job');
reset role;
select is((select on_hand from public.stock_items where id = :'roll'), 21.00::numeric, 'voided pull returns stock');
select is((select voided_at is not null from public.job_costs where id = :'pull'), true, 'cost voided, not deleted');

-- Payments
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_job_payment(:'job', 500000, 'check', '1043', current_date) as deposit \gset
select throws_ok(format($$ select public.record_job_payment(%L, 1600000, 'check', null, current_date) $$, :'job'), 'P0001', null,
  'cannot record more than is owed');
select is((select roofing_cents from public.money_owed()), 1500000::bigint, '$15,000 still owed on the job');
select public.record_job_payment(:'job', 1500000, 'ach', null, current_date);
reset role;
select is((select count(*)::int from public.domain_events where event_type = 'job_payment_recorded' and (payload ->> 'paid_in_full')::boolean),
  1, 'paid in full is announced once');

select tests.act_as('00000000-0000-0000-0000-000000000002');
select is((select cash_in_cents from public.cash_weeks(current_date, 1)), 2000000::bigint, 'cash in this week');
select is((select cash_out_cents from public.cash_weeks(current_date, 1)), (380000 + 270000 + 396000)::bigint,
  'cash out: stock buys, crew and the supplier bill, not pulls or own equipment');
select throws_ok(format($$ select public.void_job_payment(%L, '') $$, :'deposit'), 'P0001', 'say why', 'void needs a reason');
reset role;

-- Who can see money
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.job_costs) + (select count(*)::int from public.job_payments), 0, 'crew sees no money');
select throws_ok($$ select * from public.money_owed() $$, '42501', null, 'crew cannot see what is owed');
select throws_ok(format($$ select public.add_job_cost(%L, 'crew', 'x', 1, null, null, null, null, null) $$, :'job'), '42501', null,
  'crew cannot add costs');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select throws_ok(format($$ select public.record_job_payment(%L, 1, 'cash', null, null) $$, :'job'), 'P0002', null,
  'another company cannot touch the job');
reset role;

select * from finish();
rollback;
