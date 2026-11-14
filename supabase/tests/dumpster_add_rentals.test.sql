-- Adding dumpster rentals in a list, including ones that already happened, and
-- the price list of extra charges (Nov 13).
begin;
\ir support/fixtures.sql
select plan(50);

select id as company from public.companies where slug = 'american-prime' \gset
select id as can_1 from public.cans where label = 'C1' \gset
select id as can_2 from public.cans where label = 'C2' \gset
select id as landfill from public.landfills limit 1 \gset
select (now() at time zone 'America/New_York')::date as today \gset

insert into public.customers (id, company_id, name) values ('00000000-0000-0000-0000-0000000000c1', :'company', 'Shore Roofing');
insert into public.customers (id, company_id, name) values ('00000000-0000-0000-0000-0000000000c2', :'company', 'Bay Builders');
insert into public.sites (id, company_id, customer_id, address)
values ('00000000-0000-0000-0000-0000000000a1', :'company', '00000000-0000-0000-0000-0000000000c1', '12 Ocean Ave');
insert into public.sites (id, company_id, customer_id, address)
values ('00000000-0000-0000-0000-0000000000a2', :'company', '00000000-0000-0000-0000-0000000000c2', '5 Bay Rd');

-- Prices: $350 delivery, 7 days included, then $25 a day since a month ago, and
-- $400 delivery since 5 days ago. A mattress and a tire on the list.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.publish_price_book(35000, 7, 2500);
select public.publish_price_book(40000, 7, 2500);
insert into public.dumpster_price_items (company_id, description, unit, unit_cents) values (:'company', 'Mattress', 'each', 5000)
returning id as mattress \gset
insert into public.dumpster_price_items (company_id, description, unit, unit_cents) values (:'company', 'Tire', 'each', 2500)
returning id as tire \gset
reset role;
update public.price_books set created_at = now() - interval '60 days' where version = 1;
update public.price_books set created_at = now() - interval '30 days' where version = 2;
update public.price_books set created_at = now() - interval '5 days' where version = 3;

-- The price list is the owner's ------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ insert into public.dumpster_price_items (company_id, description, unit_cents) values (%L, 'Dry run', 7500) $$, :'company'),
  '42501', null, 'the office can''t change prices');
select is((select count(*)::int from public.dumpster_price_items), 2, 'the office can read the list to pick from it');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.dumpster_price_items), 0, 'drivers see no prices');
reset role;

-- One list: a rental that's over, one still out, one booked ----------------------------
-- Done: dropped 12 days ago, picked up 2 days ago (10 days: 3 past the 7 included),
-- 2.5 tons for $180 at the landfill, 2 mattresses.
-- $350 + 3 × $25 + $180 + 2 × $50 = $705.
-- Still out: dropped 3 days ago in C1, after the price rise, a tire. $400 + $25 = $425.
-- Booked: in two days at a new address, typed loosely.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.add_rentals(jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a1',
    'state', 'done', 'drop_date', (:'today'::date - 12), 'picked_up_on', (:'today'::date - 2), 'can_id', :'can_2',
    'tons', 2.5, 'dump_fee_cents', 18000, 'ticket_number', 'T-881', 'landfill_id', :'landfill',
    'items', jsonb_build_array(jsonb_build_object('item_id', :'mattress', 'qty', 2)), 'expected_total_cents', 70500),
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c2', 'site_id', '00000000-0000-0000-0000-0000000000a2',
    'state', 'on_site', 'drop_date', (:'today'::date - 3), 'can_id', :'can_1', 'notes', 'behind the garage',
    'items', jsonb_build_array(jsonb_build_object('item_id', :'tire', 'qty', 1)), 'expected_total_cents', 42500),
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c2', 'address', '77 Harbor Way', 'area', 'Ocean City',
    'state', 'scheduled', 'drop_date', (:'today'::date + 2))
)) as result \gset
reset role;

select :'result'::jsonb -> 0 ->> 'rental_id' as done_rental, :'result'::jsonb -> 1 ->> 'rental_id' as out_rental,
       :'result'::jsonb -> 2 ->> 'rental_id' as booked \gset
select is(jsonb_array_length(:'result'::jsonb), 3, 'one result per rental, in order');
select ok((:'result'::jsonb -> 2 ->> 'invoice_number') is null, 'a booking has no invoice yet');

select is((select status from public.rentals where id = :'done_rental'), 'closed', 'the finished rental is closed');
select is((select count(*)::int from public.stops where rental_id = :'done_rental' and status = 'done'), 3,
  'its drop, pickup and dump are recorded');
select is((select scheduled_date from public.stops where rental_id = :'done_rental' and kind = 'pickup'), :'today'::date - 2,
  'the pickup is on the day it happened');
select is((select app.local_date(:'company', dropped_at) from public.rentals where id = :'done_rental'), :'today'::date - 12,
  'the drop is on the day it happened');
select is((select status from public.invoices where rental_id = :'done_rental'), 'final', 'its invoice is final, ready for a statement');
select is((select total_cents from public.invoices where rental_id = :'done_rental'), 70500, 'delivery, extra days, disposal and charges');
select is((select amount_cents from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
           where i.rental_id = :'done_rental' and l.kind = 'extended_days'), 7500, 'extra days counted from drop to pickup');
select is((select description from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
           where i.rental_id = :'done_rental' and l.kind = 'charge'), 'Mattress: 2 at $50.00', 'a charge line says what and how many');
select is((select fee_cents from public.scale_tickets where rental_id = :'done_rental'), 18000, 'the scale ticket is recorded');
select is((select description from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
           where i.rental_id = :'done_rental' and l.kind = 'tonnage'), 'Disposal: 2.5 tons, ticket T-881', 'disposal reads like a driver''s');
select is((select status from public.cans where id = :'can_2'), 'available', 'a finished rental leaves its can in the yard');
select is((select count(*)::int from public.domain_events where aggregate_id = :'done_rental' and event_type = 'rental_recorded'), 1,
  'the history says it was recorded after the fact');
select is((select count(*)::int from public.stop_photos where rental_id = :'done_rental'), 0, 'no photos are invented');

select is((select status from public.rentals where id = :'out_rental'), 'on_site', 'the rental still out is on the job');
select is((select status from public.cans where id = :'can_1'), 'on_site', 'its can left the yard');
select is((select status from public.invoices where rental_id = :'out_rental'), 'draft', 'its invoice stays open until the dump');
select is((select total_cents from public.invoices where rental_id = :'out_rental'), 42500, 'delivery at the newer price, and the tire');
select is((select p.version from public.rentals r join public.price_books p on p.id = r.price_book_id where r.id = :'done_rental'), 2,
  'a rental entered late keeps the prices of its drop day');
select is((select notes from public.rentals where id = :'out_rental'), 'behind the garage', 'notes come through');

select is((select status from public.rentals where id = :'booked'), 'scheduled', 'the booking is scheduled');
select is((select scheduled_date from public.stops where rental_id = :'booked' and kind = 'drop' and status = 'scheduled'),
  :'today'::date + 2, 'its drop is on the run for its day');
select is((select area from public.sites s join public.rentals r on r.site_id = s.id where r.id = :'booked'), 'Ocean City',
  'a new address becomes one of the customer''s');

-- The rental still out finishes the normal way: a pickup counts days from the recorded drop.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.request_pickup(:'out_rental', :'today') as pickup_stop \gset
select public.complete_stop(:'pickup_stop', null, tests.photo());
reset role;
select is((select status from public.rentals where id = :'out_rental'), 'picked_up', 'a recorded drop picks up like any other');

-- All or nothing ------------------------------------------------------------------------
select count(*)::int as before from public.rentals \gset
select count(*)::int as sites_before from public.sites \gset
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '9 New St', 'state', 'scheduled', 'drop_date', :'today'),
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '9 new st.', 'state', 'scheduled', 'drop_date', :'today')
)), 'P0001', null, 'the same rental twice in one list is refused');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '12 OCEAN AVE', 'state', 'done',
    'drop_date', (:'today'::date - 12), 'picked_up_on', :'today', 'tons', 1, 'dump_fee_cents', 100, 'expected_total_cents', 1)
)), 'P0001', null, 'a rental already in Rake is refused, however the address is typed');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a1',
    'state', 'on_site', 'drop_date', :'today', 'can_id', :'can_1', 'expected_total_cents', 40000)
)), 'P0001', 'Rental 1: can C1 isn''t in the yard in Rake; check where it is', 'a can already out can''t go out again');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a1',
    'state', 'on_site', 'drop_date', :'today', 'can_id', (select id from public.cans where label = 'C3'), 'expected_total_cents', 30000)
)), 'P0001', null, 'a total other than the one shown is refused');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a1',
    'state', 'done', 'drop_date', :'today', 'picked_up_on', (:'today'::date - 1), 'tons', 1, 'dump_fee_cents', 100, 'expected_total_cents', 40100)
)), 'P0001', 'Rental 1: the pickup is before the drop', 'a pickup before its drop is refused');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a1',
    'state', 'done', 'drop_date', (:'today'::date - 5), 'picked_up_on', :'today', 'dump_fee_cents', 100, 'expected_total_cents', 40100)
)), 'P0001', 'Rental 1: enter the tons from the scale ticket', 'a finished rental needs its scale ticket');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a1',
    'state', 'scheduled', 'drop_date', (:'today'::date - 1))
)), 'P0001', 'Rental 1: a drop before today already happened: say which can went out, or move it to today or later',
  'a booking can''t be in the past');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '3 Later Ln', 'state', 'scheduled', 'drop_date', :'today',
    'items', jsonb_build_array(jsonb_build_object('item_id', :'tire', 'qty', 1)))
)), 'P0001', 'Rental 1: line items go on once the can is dropped', 'a booking has no invoice for line items yet');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '4 Later Ln', 'state', 'on_site',
    'drop_date', (:'today'::date + 1), 'can_id', (select id from public.cans where label = 'C3'), 'expected_total_cents', 40000)
)), 'P0001', 'Rental 1: it''s dated after today, so it can''t have been dropped yet', 'a drop can''t be in the future');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '5 Later Ln', 'state', 'scheduled', 'drop_date', :'today'),
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'site_id', '00000000-0000-0000-0000-0000000000a2',
    'state', 'scheduled', 'drop_date', :'today')
)), 'P0002', 'Rental 2: that address isn''t one of this customer''s', 'the error names the rental, and one customer''s address can''t be used for another');
reset role;
select is((select count(*)::int from public.rentals), :before, 'a refused list adds no rentals');
select is((select count(*)::int from public.sites), :sites_before, 'and no addresses');
select is((select status from public.cans where label = 'C3'), 'available', 'and moves no cans');

-- Loosely typed, an existing address is reused rather than added twice.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.add_rentals(jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '12 ocean ave.', 'state', 'scheduled', 'drop_date', :'today'::date + 5)
)) as reuse \gset
reset role;
select is((select site_id from public.rentals where id = (:'reuse'::jsonb -> 0 ->> 'rental_id')::uuid),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the customer''s existing address is reused');

-- Charges on an open invoice ------------------------------------------------------------
select id as out_invoice from public.invoices where rental_id = :'out_rental' \gset
select tests.act_as('00000000-0000-0000-0000-000000000002');
select is(public.add_invoice_charges(:'out_invoice', jsonb_build_array(
  jsonb_build_object('item_id', :'mattress', 'qty', 1), jsonb_build_object('item_id', :'tire', 'qty', 3))), 2, 'two charges in one go');
select throws_ok(format($$ select public.add_invoice_charges(%L, %L) $$, :'out_invoice',
  jsonb_build_array(jsonb_build_object('item_id', :'tire', 'qty', 1), jsonb_build_object('item_id', :'tire', 'qty', 2))), 'P0001',
  'an item is picked twice; put the total in one line', 'an item picked twice is refused');
reset role;
select is((select count(*)::int from public.invoice_lines where invoice_id = :'out_invoice' and kind = 'charge'), 3,
  'charges are their own lines, as many as needed');
select id as tire_line from public.invoice_lines where invoice_id = :'out_invoice' and description = 'Tire: 3 at $25.00' \gset
select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok(format($$ select public.remove_invoice_adjustment(%L) $$, :'tire_line'), 'a charge comes off before billing');
reset role;

-- Once on a statement, the invoice is closed to charges.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.issue_statements();
select throws_ok(format($$ select public.add_invoice_charges(%L, %L) $$,
  (select id from public.invoices where rental_id = :'done_rental'), jsonb_build_array(jsonb_build_object('item_id', :'tire', 'qty', 1))),
  'P0001', null, 'charges can''t be added once the invoice is on a statement');
reset role;
select is((select status from public.invoices where rental_id = :'done_rental'), 'on_statement', 'the recorded rental billed on the next statement');

-- Who can use it -------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '1 Driver St', 'state', 'scheduled', 'drop_date', :'today'))),
  '42501', 'not authorized', 'drivers can''t add rentals');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select throws_ok(format($$ select public.add_rentals(%L) $$, jsonb_build_array(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000000c1', 'address', '1 Other St', 'state', 'scheduled', 'drop_date', :'today'))),
  'P0002', 'Rental 1: pick the customer', 'another company can''t add rentals for this company''s customer');
reset role;

select * from finish();
rollback;
