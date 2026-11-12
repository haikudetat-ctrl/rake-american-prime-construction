-- Weekly billing: closed jobs wait for one statement per contractor, issued by
-- the Monday cron or the office, paid with one check.
begin;
\ir support/fixtures.sql
select plan(30);

select id as company from public.companies where slug = 'american-prime' \gset
select app.company_today(:'company') as today \gset
select (date_trunc('week', :'today'::date)::date - 7) as last_monday \gset

select tests.act_as('00000000-0000-0000-0000-000000000002');
insert into public.sub_contractors (company_id, name, billing_email, cents_per_sq, pitch_tiers, payment_terms_days)
values (:'company', 'Weekly GC', 'ap@weekly.example', 10000, '[]', 14) returning id as weekly \gset
insert into public.sub_contractors (company_id, name, billing_email, cents_per_sq, pitch_tiers, billing)
values (:'company', 'Per Job GC', 'ap@perjob.example', 10000, '[]', 'per_job') returning id as perjob \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Avery') returning id as avery \gset
insert into public.sub_settings (company_id, crew_cents_per_sq, crew_pitch_tiers) values (:'company', 5000, '[]');

-- Last Monday and Tuesday for the weekly contractor, today for both.
select public.create_sub_job(:'weekly', :'last_monday'::date, '1 Monday Road', null, array[:'avery']::uuid[]) as mon \gset
select public.create_sub_job(:'weekly', :'last_monday'::date + 1, '2 Tuesday Road', null, array[:'avery']::uuid[]) as tue \gset
select public.create_sub_job(:'weekly', :'today'::date, '3 Today Road', null, array[:'avery']::uuid[]) as now_job \gset
select public.create_sub_job(:'perjob', :'last_monday'::date, '4 Per Job Road', null, array[:'avery']::uuid[]) as pj \gset
select public.complete_sub_job(:'mon', 10, 6) as mon_invoice \gset
select public.complete_sub_job(:'tue', 20, 6) as tue_invoice \gset
select public.complete_sub_job(:'now_job', 5, 6) as now_invoice \gset
select public.complete_sub_job(:'pj', 10, 6) as pj_invoice \gset
reset role;

select is((select billing from public.sub_contractors where id = :'weekly'), 'weekly', 'contractors are billed weekly unless set otherwise');
select is((select count(*)::int from public.outbox_messages where kind = 'sub_invoice_issued'
  and payload ->> 'invoice_id' in (:'mon_invoice', :'tue_invoice', :'now_invoice')), 0,
  'closing a weekly contractor''s job emails nothing');
select is((select count(*)::int from public.outbox_messages where kind = 'sub_invoice_issued' and payload ->> 'invoice_id' = :'pj_invoice'), 1,
  'a per-job contractor still gets its invoice by email');

-- Monday cron ------------------------------------------------------------------------------
select public.issue_sub_statements(:'company') as cron_statement \gset
select is((select count(*)::int from public.sub_statements), 1, 'the cron issues one statement, only for the weekly contractor');
select is((select total_cents from public.sub_statements where id = :'cron_statement'), 300000, 'it bills last week''s two jobs: $1,000 + $2,000');
select is((select period_start from public.sub_statements where id = :'cron_statement'), :'last_monday'::date, 'its period starts at the first job');
select is((select period_end from public.sub_statements where id = :'cron_statement'), :'last_monday'::date + 1, 'and ends at the last');
select is((select statement_id from public.sub_invoices where id = :'now_invoice'), null, 'this week''s job waits for next week''s statement');
select is((select count(*)::int from public.sub_invoices where statement_id = :'cron_statement'), 2, 'both of last week''s invoices are on it');
select is((select bool_and(due_on = (select due_on from public.sub_statements where id = :'cron_statement')) from public.sub_invoices
  where statement_id = :'cron_statement'), true, 'its invoices fall due with the statement');
select is((select count(*)::int from public.outbox_messages where kind = 'sub_statement_issued' and payload ->> 'statement_id' = :'cron_statement'), 1,
  'one email goes out with the statement');
select is((select count(*)::int from public.issue_sub_statements(:'company')), 0, 'running the cron again bills nothing twice');

-- The office bills the rest now ---------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.issue_sub_statement(:'weekly') as office_statement \gset
select throws_ok(format($$ select public.issue_sub_statement(%L) $$, :'weekly'), 'P0001',
  'nothing to bill: no closed jobs waiting for a statement', 'issuing again with nothing waiting is refused');
reset role;
select is((select total_cents from public.sub_statements where id = :'office_statement'), 50000, 'the office statement bills today''s job');
select isnt((select number from public.sub_statements where id = :'office_statement'), (select number from public.sub_statements where id = :'cron_statement'),
  'every statement has its own number');

-- A job on a statement can't be reopened until the statement is voided.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.reopen_sub_job(%L, 'wrong squares') $$, :'mon'), 'P0001', null,
  'reopening a job on a statement is refused');
reset role;

-- One check, spread oldest first -----------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.record_sub_statement_payment(%L, 300001, 'check', '1', null) $$, :'cron_statement'), 'P0001', null,
  'can''t record more than the statement owes');
select public.record_sub_statement_payment(:'cron_statement', 150000, 'check', '4412', :'today'::date);
reset role;
select is((select status from public.sub_invoices where id = :'mon_invoice'), 'paid', 'the oldest invoice is paid first');
select is((select coalesce(sum(amount_cents), 0)::int from public.sub_payments where invoice_id = :'tue_invoice'), 50000, 'the rest goes to the next one');
select is((select status from public.sub_statements where id = :'cron_statement'), 'open', 'a part-paid statement stays open');
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_sub_statement_payment(:'cron_statement', 150000, 'ach', null, :'today'::date);
reset role;
select is((select status from public.sub_statements where id = :'cron_statement'), 'paid', 'paid in full closes the statement');
select is((select count(*)::int from public.sub_invoices where statement_id = :'cron_statement' and status = 'paid'), 2, 'and every invoice on it');

-- A bounced check opens it again.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.void_sub_payment((select id from public.sub_payments where reference = '4412' and invoice_id = :'mon_invoice'), 'Bounced');
reset role;
select is((select status from public.sub_statements where id = :'cron_statement'), 'open', 'voiding a payment reopens the statement');

-- Voiding a statement --------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.void_sub_statement(%L, 'wrong') $$, :'office_statement'), '42501', null, 'the office can''t void a statement');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.void_sub_statement(%L, 'wrong') $$, :'cron_statement'), 'P0001', null,
  'a statement with a payment on it can''t be voided');
select public.void_sub_statement(:'office_statement', 'Squares were wrong');
select lives_ok(format($$ select public.reopen_sub_job(%L, 'It was 4 squares') $$, :'now_job'), 'after the void, the job can be reopened');
reset role;
select is((select status from public.sub_statements where id = :'office_statement'), 'void', 'the statement is void');
select is((select statement_id from public.sub_invoices where id = :'now_invoice'), null, 'its invoices go back to waiting');

-- Who sees statements -----------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.sub_statements), 0, 'drivers see no statements');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.sub_statements), 0, 'another company sees none');
reset role;

select * from finish();
rollback;
