-- Row-level security: who can see and do what. The rule that matters most:
-- drivers never see money.
begin;
\ir support/fixtures.sql
select plan(33);

-- Build one rental with an invoice, a request, and stops for both drivers.
select tests.act_as_service();
select public.submit_rental_request(
  'dumpster', 'Pat', 'Shore Roofing', '+15551110000', 'billing@shore.example', '12 Ocean Ave', 'Ventnor City',
  null, null, null, (now() at time zone 'America/New_York')::date, 20, null, 'h1') as req_1 \gset
select public.submit_rental_request(
  'dumpster', 'Sam', 'Bay Roofing', '+15552220000', null, '9 Bay Rd', 'Somers Point',
  null, null, null, (now() at time zone 'America/New_York')::date, 20, null, 'h2') as req_2 \gset
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.approve_request(:'req_1', null, null, '00000000-0000-0000-0000-000000000003') as rental_a \gset
select public.approve_request(:'req_2', null, null, '00000000-0000-0000-0000-000000000004') as rental_b \gset
reset role;
select id as stop_a from public.stops where rental_id = :'rental_a' \gset
select id as stop_b from public.stops where rental_id = :'rental_b' \gset
select id as can_1 from public.cans where label = 'C1' \gset
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.complete_stop(:'stop_a', :'can_1', tests.photo());
reset role;

-- Driver A ------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');

select is((select count(*)::int from public.invoices), 0, 'driver: no invoices');
select is((select count(*)::int from public.invoice_lines), 0, 'driver: no invoice lines');
select is((select count(*)::int from public.statements), 0, 'driver: no statements');
select is((select count(*)::int from public.payments), 0, 'driver: no payments');
select is((select count(*)::int from public.price_books), 0, 'driver: no price books');
select is((select count(*)::int from public.customers), 0, 'driver: no customer records');
select is((select count(*)::int from public.rentals), 0, 'driver: no rental records');
select is((select count(*)::int from public.rental_requests), 0, 'driver: no requests');
select is((select count(*)::int from public.rentals_out), 0, 'driver: no live board');
select is((select count(*)::int from public.stops), 1, 'driver: only their own stop');
select is((select count(*)::int from public.stops where driver_id <> auth.uid()), 0, 'driver: never another driver''s stops');
select is((select count(*)::int from public.cans), 3, 'driver: can pick a can');
select is((select count(*)::int from public.landfills), 1, 'driver: can pick a landfill');

select is((select count(*)::int from public.driver_run((now() at time zone 'America/New_York')::date)), 1,
  'driver_run returns only driver A''s stop');
select ok(
  not exists (
    select 1 from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'driver_run'
      and p.parameter_mode = 'OUT' and (p.parameter_name ilike '%cents%' or p.parameter_name ilike '%fee%'
        or p.parameter_name ilike '%price%' or p.parameter_name ilike '%email%')
  ),
  'driver_run returns no price, fee or billing columns'
);

select throws_ok(format($$ select public.complete_stop(%L, null) $$, :'stop_b'), '42501', 'not authorized',
  'driver cannot work another driver''s stop');
select throws_ok(format($$ select public.approve_request(%L, null, null) $$, :'req_1'), '42501', 'not authorized',
  'driver cannot approve requests');
select throws_ok($$ select public.issue_statements(null) $$, '42501', 'not authorized', 'driver cannot bill');
select throws_ok($$ select * from public.weekly_numbers(current_date) $$, '42501', 'not authorized',
  'driver cannot read weekly money numbers');
select throws_ok($$ insert into public.customers (company_id, name) select id, 'x' from public.companies $$,
  '42501', null, 'driver cannot add customers');
update public.cans set status = 'out_of_service';
select is((select count(*)::int from public.cans where status = 'out_of_service'), 0, 'driver cannot edit cans');
select is((select count(*)::int from public.companies), 1, 'driver sees their own company only');
reset role;

-- Crew (Phase 2 role) sees nothing operational -----------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.cans), 0, 'crew: no cans');
select is((select count(*)::int from public.stops), 0, 'crew: no stops');
reset role;

-- Office ------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.invoices), 1, 'office sees invoices');
select is((select count(*)::int from public.stops), 2, 'office sees every stop');
select is((select count(*)::int from public.customers), 2, 'office sees only this company''s customers');
select lives_ok($$ insert into public.customers (company_id, name) select app.current_company_id(), 'Walk-in' $$,
  'office adds a customer');
select throws_ok($$ select public.publish_price_book(1, 1, 1) $$, '42501', 'not authorized',
  'only owners change prices');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.qbo_connections $$, '42501', null,
  'not even an owner can read QuickBooks tokens from the browser');
reset role;

-- Another company's owner sees none of it ---------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.rentals), 0, 'other company: no rentals');
select is((select count(*)::int from public.invoices), 0, 'other company: no invoices');
reset role;

-- Public and signed-in users cannot call the intake directly ----------------------------
select tests.act_as_anon();
select throws_ok($$ select public.submit_rental_request('dumpster','x',null,'+1',null,'a',null,null,null,null,current_date,null,null,'h') $$,
  '42501', null, 'anon cannot call intake directly');
reset role;

select * from finish();
rollback;
