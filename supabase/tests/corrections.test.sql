-- Correcting mistakes: cancel, reschedule, swap can, undo, adjustments, voids.
begin;
\ir support/fixtures.sql
select plan(32);

-- A customer with one site, and helpers to book and run rentals --------------------
insert into public.customers (id, company_id, name, billing_email)
select '00000000-0000-0000-0000-0000000000c1', id, 'Shore Roofing', 'billing@shore.example'
from public.companies where slug = 'american-prime';
insert into public.sites (id, company_id, customer_id, address)
select '00000000-0000-0000-0000-0000000000a1', id, '00000000-0000-0000-0000-0000000000c1', '12 Ocean Ave'
from public.companies where slug = 'american-prime';
select id as can_1 from public.cans where label = 'C1' \gset
select id as can_2 from public.cans where label = 'C2' \gset
select id as landfill from public.landfills limit 1 \gset
select (now() at time zone 'America/New_York')::date as today \gset

-- Cancel before drop -----------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_rental('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  :'today', '00000000-0000-0000-0000-000000000003') as r_cancel \gset
select lives_ok(format($$ select public.cancel_rental(%L, 'customer called off') $$, :'r_cancel'), 'office cancels before drop');
reset role;
select is((select status from public.rentals where id = :'r_cancel'), 'cancelled', 'rental cancelled');
select is((select count(*)::int from public.stops where rental_id = :'r_cancel' and status = 'scheduled'), 0,
  'its drop leaves the run');

-- Reschedule moves the requested date too ------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_rental('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  :'today', '00000000-0000-0000-0000-000000000003') as r1 \gset
select id as r1_drop from public.stops where rental_id = :'r1' and kind = 'drop' \gset
select public.assign_stop(:'r1_drop', '00000000-0000-0000-0000-000000000003', (:'today'::date + 2));
select public.assign_stop(:'r1_drop', '00000000-0000-0000-0000-000000000003', :'today');
reset role;
select is((select requested_drop_date from public.rentals where id = :'r1'), :'today'::date,
  'moving the drop moves the rental date');

-- Drop, then swap the can -----------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.complete_stop(:'r1_drop', :'can_1', tests.photo());
select throws_ok(format($$ select public.cancel_rental(%L, 'x') $$, :'r1'), '42501', null,
  'drivers cannot cancel');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.cancel_rental(%L, 'x') $$, :'r1'), 'P0001',
  'only a rental that has not been dropped can be cancelled', 'a dropped rental cannot be cancelled');
select lives_ok(format($$ select public.swap_can(%L, %L) $$, :'r1', :'can_2'), 'office swaps the can');
reset role;
select is((select can_id from public.rentals where id = :'r1'), :'can_2'::uuid, 'rental now has can 2');
select is((select status from public.cans where id = :'can_1'), 'available', 'can 1 back in the yard');
select is((select status from public.cans where id = :'can_2'), 'on_site', 'can 2 on the job');

-- Undo a drop (owner only) ----------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.undo_stop(%L) $$, :'r1_drop'), '42501', 'only an owner can do that',
  'office cannot undo driver steps');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.undo_stop(%L) $$, :'r1_drop'), 'owner undoes the drop');
reset role;
select is((select status from public.rentals where id = :'r1'), 'scheduled', 'rental back to scheduled');
select is((select count(*)::int from public.invoices where rental_id = :'r1'), 0, 'draft invoice removed');
select is((select status from public.cans where id = :'can_2'), 'available', 'can back in the yard');
select is((select status from public.stops where id = :'r1_drop'), 'scheduled', 'drop is on the run again');

-- Redo the drop, pick up, dump; then undo the dump ---------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.complete_stop(:'r1_drop', :'can_1', tests.photo());
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.request_pickup(:'r1', :'today', '00000000-0000-0000-0000-000000000003') as r1_pickup \gset
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.complete_stop(:'r1_pickup', null, tests.photo());
reset role;
select id as r1_dump from public.stops where rental_id = :'r1' and kind = 'dump' \gset
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.record_scale_ticket(:'r1_dump', :'landfill', 'T-1', 2.00, 20000);
reset role;

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.undo_stop(%L) $$, :'r1_pickup'), 'P0001', 'undo the later step first',
  'steps undo newest first');
select lives_ok(format($$ select public.undo_stop(%L) $$, :'r1_dump'), 'owner undoes the dump');
reset role;
select is((select status from public.invoices where rental_id = :'r1'), 'draft', 'invoice back to draft');
select is((select total_cents from public.invoices where rental_id = :'r1'), 35000, 'tonnage line removed');
select is((select count(*)::int from public.scale_tickets where rental_id = :'r1'), 0, 'ticket removed');

-- Re-enter the corrected ticket ---------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.record_scale_ticket(:'r1_dump', :'landfill', 'T-1', 1.50, 15000);
reset role;

-- Adjustments ---------------------------------------------------------------------------
select id as inv1 from public.invoices where rental_id = :'r1' \gset
select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok(format($$ select public.add_invoice_adjustment(%L, 'Loyalty credit', -5000) $$, :'inv1'),
  'office adds a credit');
select throws_ok(format($$ select public.add_invoice_adjustment(%L, 'Too much', -999999) $$, :'inv1'),
  'P0001', 'an invoice cannot go below zero', 'credits cannot take an invoice negative');
reset role;
select is((select total_cents from public.invoices where id = :'inv1'), 45000, '350 + 150 − 50');

-- Statement, then void it to fix it ----------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.issue_statements(null) as st1 \gset
select throws_ok(format($$ select public.add_invoice_adjustment(%L, 'Late fix', 1000) $$, :'inv1'),
  'P0001', null, 'billed invoices cannot be adjusted');
select throws_ok(format($$ select public.void_statement(%L, 'wrong') $$, :'st1'), '42501', null,
  'only owners void statements');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.void_statement(%L, 'wrong credit') $$, :'st1'), 'owner voids the statement');
reset role;
select is((select status from public.invoices where id = :'inv1'), 'final', 'invoice is ready to bill again');

-- Void an invoice ----------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.void_invoice(:'inv1', 'duplicate booking');
select is((select count(*)::int from public.issue_statements(null)), 0, 'a void invoice never bills');
reset role;

-- Payments block voiding a statement --------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_rental('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  :'today', '00000000-0000-0000-0000-000000000003') as r2 \gset
reset role;
select id as r2_drop from public.stops where rental_id = :'r2' and kind = 'drop' \gset
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.complete_stop(:'r2_drop', :'can_2', tests.photo());
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.request_pickup(:'r2', :'today', '00000000-0000-0000-0000-000000000003') as r2_pickup \gset
select public.complete_stop(:'r2_pickup', null, tests.photo());
reset role;
select id as r2_dump from public.stops where rental_id = :'r2' and kind = 'dump' \gset
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.record_scale_ticket(:'r2_dump', :'landfill', null, 1, 10000);
select public.issue_statements(null) as st2 \gset
select public.record_payment(:'st2', 1000, 'check', '9', :'today');
select throws_ok(format($$ select public.void_statement(%L, 'x') $$, :'st2'), 'P0001',
  'a payment has been recorded against this statement', 'a paid-against statement cannot be voided');
select throws_ok(format($$ select public.undo_stop(%L) $$, :'r2_dump'), 'P0001', null,
  'steps on a billed rental cannot be undone');
reset role;

-- A can that went out again blocks undoing the dump that freed it ---------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_rental('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  :'today', '00000000-0000-0000-0000-000000000003') as r3 \gset
select public.create_rental('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  :'today', '00000000-0000-0000-0000-000000000003') as r4 \gset
reset role;
select id as r3_drop from public.stops where rental_id = :'r3' and kind = 'drop' \gset
select id as r4_drop from public.stops where rental_id = :'r4' and kind = 'drop' \gset
select id as can_3 from public.cans where label = 'C3' \gset
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.complete_stop(:'r3_drop', :'can_3', tests.photo());
select public.request_pickup(:'r3', :'today', '00000000-0000-0000-0000-000000000003') as r3_pickup \gset
select public.complete_stop(:'r3_pickup', null, tests.photo());
reset role;
select id as r3_dump from public.stops where rental_id = :'r3' and kind = 'dump' \gset
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.record_scale_ticket(:'r3_dump', :'landfill', null, 1, 10000);
select public.complete_stop(:'r4_drop', :'can_3', tests.photo());
select throws_ok(format($$ select public.undo_stop(%L) $$, :'r3_dump'), 'P0001',
  'that can has already gone out on another job', 'undo refuses when the can is out again');
reset role;

select * from finish();
rollback;
