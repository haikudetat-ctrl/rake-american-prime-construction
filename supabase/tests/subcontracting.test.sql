-- Subcontracting: rate math, crew split, per-job invoice, payroll, payments,
-- reopening, and who can see any of it.
begin;
\ir support/fixtures.sql
select plan(45);

select id as company from public.companies where slug = 'american-prime' \gset

-- Pitch steps from 9/12 at $5 a square: the numbers Andre gave on the call.
select is(app.sub_pitch_cents(9, 500, 6), 0, 'no pitch extra below 9/12');
select is(app.sub_pitch_cents(9, 500, 9), 500, '9/12 pays one step');
select is(app.sub_pitch_cents(9, 500, 12), 2000, '12/12 pays $20 a square extra');

-- Setup as the office: two contractors, four guys, the crew rates. ----------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
insert into public.sub_contractors (company_id, name, billing_email, cents_per_sq, payment_terms_days)
values (:'company', 'All Season', 'ap@allseason.example', 9500, 14) returning id as all_season \gset
insert into public.sub_contractors (company_id, name, cents_per_sq) values (:'company', 'Rampage', 11000) returning id as rampage \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Baltimore') returning id as baltimore \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Carlos') returning id as carlos \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Walter') returning id as walter \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Fernando') returning id as fernando \gset
insert into public.sub_settings (company_id) values (:'company');
reset role;
select is((select crew_cents_per_sq from public.sub_settings where company_id = :'company'), 5000, 'crew base defaults to $50 a square');

-- Monday: Baltimore, Carlos and Walter on an All Season roof. -------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'all_season', current_date, '232 Hewitt St, Trenton', null,
  array[:'baltimore', :'carlos', :'walter']::uuid[]) as job1 \gset
reset role;
select is((select status from public.sub_jobs where id = :'job1'), 'scheduled', 'job starts scheduled');
select is((select count(*)::int from public.sub_job_crew where job_id = :'job1'), 3, 'three guys on the job');

-- Crew changed: Fernando swaps in for Walter.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.update_sub_job(:'job1', :'all_season', current_date, '232 Hewitt St, Trenton', 'Gate code 1234',
  array[:'baltimore', :'carlos', :'fernando']::uuid[]);
select public.add_sub_job_extra(:'job1', 'Plywood sheet', 3, 4500, 1500);
select throws_ok(format($$ select public.complete_sub_job(%L, 0, 12) $$, :'job1'), 'P0001', 'enter the squares', 'squares are required');
select throws_ok(format($$ select public.complete_sub_job(%L, 25, 30) $$, :'job1'), 'P0001', 'enter the pitch (0 to 24)', 'pitch is checked');
select public.complete_sub_job(:'job1', 25, 12) as invoice1 \gset
reset role;

select ok(
  (select array_agg(w.name order by w.name) from public.sub_job_crew c join public.sub_workers w on w.id = c.worker_id where c.job_id = :'job1')
    = array['Baltimore', 'Carlos', 'Fernando'], 'the crew edit replaced Walter with Fernando');
-- Bill: 25 sq × ($95 + $20) + 3 sheets × $45 = $2,875 + $135.
select is((select bill_total_cents from public.sub_jobs where id = :'job1'), 301000, 'contractor is billed squares, pitch and plywood');
-- Pay: 25 sq × ($50 + $20) + 3 sheets × $15 = $1,750 + $45.
select is((select pay_total_cents from public.sub_jobs where id = :'job1'), 179500, 'crew pot is squares, pitch and plywood at crew rates');
select is((select sum(pay_cents)::int from public.sub_job_crew where job_id = :'job1'), 179500, 'shares add up to the pot exactly');
select is((select pay_cents from public.sub_job_crew where job_id = :'job1' and worker_id = :'baltimore'), 59834,
  'the leftover cent goes to the first name');
select is((select pay_cents from public.sub_job_crew where job_id = :'job1' and worker_id = :'fernando'), 59833, 'everyone else splits evenly');
select is((select pitch_bill from (select bill_pitch_cents as pitch_bill from public.sub_jobs where id = :'job1') x), 2000,
  'the pitch extra is frozen on the job');

-- The invoice is issued the moment the job closes. ----------------------------------------
select is((select status from public.sub_invoices where id = :'invoice1'), 'open', 'invoice issued on close');
select is((select total_cents from public.sub_invoices where id = :'invoice1'), 301000, 'invoice total matches the job');
select is((select due_on - issued_on from public.sub_invoices where id = :'invoice1'), 14, 'due on the contractor''s terms');
select is((select count(*)::int from public.outbox_messages where kind = 'sub_invoice_issued' and payload ->> 'invoice_id' = :'invoice1'
  and run_after > now() + interval '14 minutes'), 1, 'invoice email queued, held 15 minutes for corrections');
-- A dumpster invoice right after takes the next number: one sequence for every American Prime invoice.
select is(app.next_number(:'company', 'invoice'), (select number + 1 from public.sub_invoices where id = :'invoice1'),
  'sub and dumpster invoices share one number sequence');

select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.add_sub_job_extra(%L, 'Extra layer', 25, 1000, 500) $$, :'job1'), 'P0001',
  'reopen the job to change it', 'a closed job can''t take extras');
select throws_ok(format($$ select public.complete_sub_job(%L, 25, 12) $$, :'job1'), 'P0001', 'job is already done',
  'a job closes once');
reset role;

-- A rate change later never touches a closed job.
update public.sub_contractors set cents_per_sq = 9000 where id = :'all_season';
select is((select bill_total_cents from public.sub_jobs where id = :'job1'), 301000, 'closed job keeps the rate it closed at');

-- Tuesday: Rampage, two guys, 20 squares at 6/12. ------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'rampage', current_date + 1, '9 Elm St, Ewing', null, array[:'baltimore', :'walter']::uuid[]) as job2 \gset
select public.create_sub_job(:'rampage', current_date + 1, '1 Nobody Rd', null, '{}'::uuid[]) as job3 \gset
select throws_ok(format($$ select public.complete_sub_job(%L, 10, 6) $$, :'job3'), 'P0001', 'pick who worked the job first',
  'a job needs a crew to close');
select public.cancel_sub_job(:'job3', 'Rained out');
select public.complete_sub_job(:'job2', 20, 6) as invoice2 \gset
reset role;
select is((select bill_total_cents from public.sub_jobs where id = :'job2'), 220000, 'Rampage: 20 sq × $110, no pitch extra');
select is((select pay_cents from public.sub_job_crew where job_id = :'job2' and worker_id = :'walter'), 50000, 'two guys split $1,000');
select is((select status from public.sub_jobs where id = :'job3'), 'void', 'a rained-out job is cancelled');
select is((select count(*)::int from public.outbox_messages where kind = 'sub_invoice_issued' and payload ->> 'invoice_id' = :'invoice2'),
  0, 'no email when the contractor has no billing address');

-- Payroll for the week: Baltimore worked both jobs. -------------------------------------------
select is(
  (select sum(c.pay_cents)::int from public.sub_job_crew c join public.sub_jobs j on j.id = c.job_id
   where c.worker_id = :'baltimore' and j.status = 'done'
     and j.work_date >= date_trunc('week', current_date)::date and j.work_date < date_trunc('week', current_date)::date + 14),
  109834, 'Baltimore''s pay across the jobs he worked');

-- Wrong squares on job 2: reopen (owner only), fix, close again. --------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.reopen_sub_job(%L, 'wrong squares') $$, :'job2'), '42501', null, 'office can''t reopen');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.reopen_sub_job(:'job2', 'It was 22 squares');
reset role;
select is((select status from public.sub_invoices where id = :'invoice2'), 'void', 'reopening voids the unpaid invoice');
select is((select status from public.sub_jobs where id = :'job2'), 'scheduled', 'and puts the job back');
select ok((select bool_and(pay_cents is null) from public.sub_job_crew where job_id = :'job2'), 'crew pay clears until it closes again');
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.complete_sub_job(:'job2', 22, 6) as invoice2b \gset
reset role;
select isnt((select number from public.sub_invoices where id = :'invoice2b'), (select number from public.sub_invoices where id = :'invoice2'),
  'the corrected invoice gets a new number; the void one stays on record');
select is((select count(*)::int from public.sub_invoices where job_id = :'job2' and status <> 'void'), 1, 'one live invoice per job');

-- Payments ----------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_sub_payment(:'invoice1', 100000, 'check', '4412', current_date) as pay1 \gset
select throws_ok(format($$ select public.record_sub_payment(%L, 300000, 'check', null, null) $$, :'invoice1'), 'P0001', null,
  'can''t record more than is owed');
select public.record_sub_payment(:'invoice1', 201000, 'ach', null, current_date);
reset role;
select is((select status from public.sub_invoices where id = :'invoice1'), 'paid', 'paid in full');
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.reopen_sub_job(%L, 'x') $$, :'job1'), 'P0001', null, 'a paid job can''t be reopened');
select public.void_sub_payment(:'pay1', 'Check bounced');
reset role;
select is((select status from public.sub_invoices where id = :'invoice1'), 'open', 'voiding a payment reopens the invoice');

-- Who sees it --------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.sub_jobs), 0, 'drivers see no subcontract jobs');
select is((select count(*)::int from public.sub_job_crew), 0, 'drivers see no crew pay');
select throws_ok(format($$ select public.create_sub_job(%L, current_date, 'x', null, '{}') $$, :'all_season'), '42501', null,
  'drivers can''t create jobs');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.sub_invoices), 0, 'crew members see no invoices');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.sub_contractors), 0, 'another company sees none of it');
select throws_ok(format($$ select public.complete_sub_job(%L, 1, 1) $$, :'job2'), 'P0002', 'job not found',
  'another company can''t close the job');
reset role;

select * from finish();
rollback;
