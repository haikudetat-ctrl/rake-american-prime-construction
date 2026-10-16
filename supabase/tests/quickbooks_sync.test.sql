-- QuickBooks payment pull-back: incremental, idempotent, service-role only.
begin;
\ir support/fixtures.sql
select plan(7);

insert into public.customers (id, company_id, name)
select '00000000-0000-0000-0000-0000000000c1', id, 'Shore Roofing' from public.companies where slug = 'american-prime';
insert into public.statements (id, company_id, customer_id, number, issued_on, due_on, total_cents)
select '00000000-0000-0000-0000-0000000000d1', id, '00000000-0000-0000-0000-0000000000c1', 2001,
       current_date, current_date + 15, 50000
from public.companies where slug = 'american-prime';

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.record_qbo_payments('00000000-0000-0000-0000-0000000000d1', 1, null) $$,
  '42501', null, 'owners cannot post QuickBooks payments directly');
select throws_ok($$ select * from public.qbo_settings $$, '42501', null, 'sync settings are server-only');
reset role;

select tests.act_as_service();
select is(public.record_qbo_payments('00000000-0000-0000-0000-0000000000d1', 20000, 'QBO'), 20000, 'first partial payment recorded');
select is(public.record_qbo_payments('00000000-0000-0000-0000-0000000000d1', 20000, 'QBO'), 0, 'same total again records nothing');
select is(public.record_qbo_payments('00000000-0000-0000-0000-0000000000d1', 50000, 'QBO'), 30000, 'only the increase is recorded');
reset role;

select is((select status from public.statements where id = '00000000-0000-0000-0000-0000000000d1'), 'paid',
  'statement paid once QuickBooks shows it covered');
select is((select sum(amount_cents)::int from public.payments where statement_id = '00000000-0000-0000-0000-0000000000d1'),
  50000, 'payments add up to the statement');

select * from finish();
rollback;
