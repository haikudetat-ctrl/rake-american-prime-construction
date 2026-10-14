-- End-to-end rental lifecycle: request → approve → drop → pickup → ticket →
-- statement → payment → reminders, checking the billing side effects of each.
begin;
\ir support/fixtures.sql
select plan(37);

-- Request link (service role, as the public route calls it) ---------------------
select tests.act_as_service();
select public.submit_rental_request(
  'dumpster', 'Pat Roofer', 'Shore Roofing', '+15551110000', 'billing@shore.example',
  '12 Ocean Ave, Ventnor City, NJ', 'Ventnor City', 39.34, -74.48, null,
  (now() at time zone 'America/New_York')::date + 1, 20, 'Back driveway', 'hash-1'
) as request_id \gset
reset role;

select is((select status from public.rental_requests where id = :'request_id'), 'pending', 'request lands pending');
select is(
  (select count(*)::int from public.outbox_messages where kind = 'request_received'),
  1, 'owner with a phone is texted about the request (office has no phone)'
);
select throws_ok(
  $$ select public.submit_rental_request('nope', 'x', null, '+1', null, 'a', null, null, null, null,
       (now() at time zone 'America/New_York')::date, null, null, 'hash-2') $$,
  'P0002', 'unknown request link', 'unknown link is rejected'
);
select throws_ok(
  $$ select public.submit_rental_request('dumpster', 'x', null, '+1', null, 'a', null, null, null, null,
       (now() at time zone 'America/New_York')::date - 1, null, null, 'hash-2') $$,
  '22023', 'requested date is in the past', 'past dates are rejected'
);

-- Approve as office --------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.approve_request(
  :'request_id', null, (now() at time zone 'America/New_York')::date,
  '00000000-0000-0000-0000-000000000003'
) as rental_id \gset
reset role;

select is((select status from public.rental_requests where id = :'request_id'), 'approved', 'request approved');
select is((select status from public.rentals where id = :'rental_id'), 'scheduled', 'rental scheduled');
select is((select name from public.customers c join public.rentals r on r.customer_id = c.id where r.id = :'rental_id'),
  'Shore Roofing', 'customer created from the request');
select is((select count(*)::int from public.stops where rental_id = :'rental_id' and kind = 'drop'
  and driver_id = '00000000-0000-0000-0000-000000000003'), 1, 'drop stop assigned to driver A');
select is((select count(*)::int from public.outbox_messages where kind = 'request_approved'), 1, 'customer confirmation queued');
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(
  format($$ select public.approve_request(%L, null, null) $$, :'request_id'),
  'P0001', null, 'a request cannot be approved twice'
);
reset role;

-- Drop by driver A -------------------------------------------------------------------
select id as drop_stop from public.stops where rental_id = :'rental_id' and kind = 'drop' \gset
select id as can_1 from public.cans where label = 'C1' \gset

select tests.act_as('00000000-0000-0000-0000-000000000003');
select throws_ok(
  format($$ select public.complete_stop(%L, null) $$, :'drop_stop'),
  'P0001', 'choose the can that was dropped', 'a drop needs a can'
);
select lives_ok(
  format($$ select public.complete_stop(%L, %L) $$, :'drop_stop', :'can_1'),
  'driver completes the drop'
);
reset role;

select is((select status from public.rentals where id = :'rental_id'), 'on_site', 'rental on site');
select is((select status from public.cans where id = :'can_1'), 'on_site', 'can on site');
select is((select total_cents from public.invoices where rental_id = :'rental_id'), 35000,
  'draft invoice opens with the delivery fee');
select is((select status from public.invoices where rental_id = :'rental_id'), 'draft', 'invoice is draft');

-- Price book snapshot: a new version does not touch the open rental ------------------
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.publish_price_book(25000, 7, 2500) as pb2 \gset
reset role;
select is((select delivery_fee_cents from public.price_books p join public.rentals r on r.price_book_id = p.id
  where r.id = :'rental_id'), 35000, 'existing rental keeps its price book version');
select throws_ok(
  $$ update public.price_books set delivery_fee_cents = 1 where version = 1 $$,
  'P0001', 'price books are immutable; publish a new version', 'price books cannot be edited in place'
);

-- Pickup 10 days later on the old price book (no per-day fee): no extended line ------
update public.rentals set dropped_at = now() - interval '10 days' where id = :'rental_id';
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.request_pickup(:'rental_id', (now() at time zone 'America/New_York')::date,
  '00000000-0000-0000-0000-000000000003') as pickup_stop \gset
reset role;

select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok(format($$ select public.complete_stop(%L) $$, :'pickup_stop'), 'driver completes pickup');
reset role;
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.rental_id = :'rental_id' and l.kind = 'extended_days'), 0,
  'no extended charge when the booked price book has none');
select is((select count(*)::int from public.stops where rental_id = :'rental_id' and kind = 'dump' and status = 'scheduled'),
  1, 'pickup creates the dump stop');

-- Second rental, booked on price book v2, kept 10 days: extended charge ---------------
select c.id as customer_id, s.id as site_id
from public.rentals r join public.customers c on c.id = r.customer_id join public.sites s on s.id = r.site_id
where r.id = :'rental_id' \gset
select id as can_2 from public.cans where label = 'C2' \gset

select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_rental(:'customer_id', :'site_id', (now() at time zone 'America/New_York')::date,
  '00000000-0000-0000-0000-000000000003') as rental_2 \gset
reset role;
select id as drop_2 from public.stops where rental_id = :'rental_2' and kind = 'drop' \gset
select tests.act_as('00000000-0000-0000-0000-000000000003');
select public.complete_stop(:'drop_2', :'can_2');
reset role;
update public.rentals set dropped_at = now() - interval '10 days' where id = :'rental_2';
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.request_pickup(:'rental_2', (now() at time zone 'America/New_York')::date,
  '00000000-0000-0000-0000-000000000003') as pickup_2 \gset
select public.complete_stop(:'pickup_2');
reset role;

select is(
  (select amount_cents from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
   where i.rental_id = :'rental_2' and l.kind = 'extended_days'),
  7500, '10 days out, 7 included, $25/day → $75 extended'
);

-- Scale tickets finish both rentals ---------------------------------------------------
select id as dump_1 from public.stops where rental_id = :'rental_id' and kind = 'dump' \gset
select id as dump_2 from public.stops where rental_id = :'rental_2' and kind = 'dump' \gset
select id as landfill from public.landfills limit 1 \gset

select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok(
  format($$ select public.record_scale_ticket(%L, %L, 'T-100', 1.50, 21000) $$, :'dump_1', :'landfill'),
  'driver records the scale ticket'
);
select public.record_scale_ticket(:'dump_2', :'landfill', 'T-101', 2.00, 28000);
reset role;

select is((select total_cents from public.invoices where rental_id = :'rental_id'), 56000,
  'invoice 1: $350 delivery + $210 tonnage at cost');
select is((select total_cents from public.invoices where rental_id = :'rental_2'), 60500,
  'invoice 2: $250 delivery + $75 extended + $280 tonnage');
select is((select status from public.invoices where rental_id = :'rental_id'), 'final', 'ticket finalizes the invoice');
select is((select status from public.rentals where id = :'rental_id'), 'closed', 'rental closed');
select is((select status from public.cans where id = :'can_1'), 'available', 'can back in the yard');

-- Monday statement ---------------------------------------------------------------------
select tests.act_as_service();
select public.issue_statements((select id from public.companies where slug = 'american-prime')) as statement_id \gset
reset role;

select is((select total_cents from public.statements where id = :'statement_id'), 116500,
  'one statement covers both invoices');
select is((select count(*)::int from public.invoices where statement_id = :'statement_id' and status = 'on_statement'),
  2, 'invoices move onto the statement');
select is((select count(*)::int from public.outbox_messages where kind = 'statement_issued'), 1, 'statement email queued');

-- Payments ------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_payment(:'statement_id', 50000, 'check', '1234', (now() at time zone 'America/New_York')::date);
reset role;
select is((select status from public.statements where id = :'statement_id'), 'open', 'partial payment leaves it open');

-- Reminders at 3 and 5 days past due, idempotent ----------------------------------------
update public.statements set due_on = due_on - 30 where id = :'statement_id';
select tests.act_as_service();
select public.enqueue_overdue_reminders((select id from public.companies where slug = 'american-prime'));
select public.enqueue_overdue_reminders((select id from public.companies where slug = 'american-prime'));
reset role;
select is((select count(*)::int from public.outbox_messages where kind = 'statement_reminder'), 2,
  'two reminders queued once each, however often the cron runs');

select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_payment(:'statement_id', 66500, 'ach', null, (now() at time zone 'America/New_York')::date);
reset role;
select is((select status from public.statements where id = :'statement_id'), 'paid', 'full payment marks it paid');
select is((select count(*)::int from public.invoices where statement_id = :'statement_id' and status = 'paid'), 2,
  'and its invoices');

-- Weekly numbers ----------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000001');
select is(
  (select rentals_picked_up from public.weekly_numbers(
    date_trunc('week', now() at time zone 'America/New_York')::date)),
  2, 'weekly numbers count this week''s pickups'
);
reset role;

-- Audit trail records the actor ----------------------------------------------------------------
select is(
  (select actor_id::text from public.audit_log where table_name = 'payments' order by id limit 1),
  '00000000-0000-0000-0000-000000000002', 'audit log records who took the payment'
);

select * from finish();
rollback;
