-- Closeout version check (#85): a review is only good for the numbers it showed.
begin;
\ir support/fixtures.sql
select plan(19);

select id as company from public.companies where slug = 'american-prime' \gset

-- Synthetic setup: one contractor, three workers, crew rates on file.
select tests.act_as('00000000-0000-0000-0000-000000000002');
insert into public.sub_contractors (company_id, name, billing_email, cents_per_sq, payment_terms_days)
values (:'company', 'Example GC', 'ap@example.com', 9500, 14) returning id as gc \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Avery') returning id as avery \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Blake') returning id as blake \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Casey') returning id as casey \gset
insert into public.sub_settings (company_id) values (:'company');
select public.create_sub_job(:'gc', current_date, '1 Example Road', null, array[:'avery', :'blake']::uuid[]) as job \gset
select public.sub_job_closeout_fingerprint(:'job') as fp \gset
reset role;

-- Closes the job with a given fingerprint; returns the refusal's detail, or 'closed'.
create function pg_temp.close_with(p_job uuid, p_fp jsonb) returns text language plpgsql as $$
declare
  v_detail text;
  v_hint text;
begin
  perform public.complete_sub_job(p_job, 20, 6, p_fp);
  return 'closed';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return coalesce(v_hint, '') || ':' || coalesce(nullif(v_detail, ''), sqlerrm);
end;
$$;

select ok(:'fp'::jsonb ?& array['crew', 'extras', 'rates', 'contractor'], 'the fingerprint names crew, extras, rates and contractor');

select tests.act_as('00000000-0000-0000-0000-000000000002');
select is(public.sub_job_closeout_fingerprint(:'job'), :'fp'::jsonb, 'the same job fingerprints the same twice');
-- Address, date and notes change no amount or recipient, so they never block a close.
select public.update_sub_job(:'job', :'gc', current_date + 1, '1 Example Road, Unit 2', 'Gate code 1234', array[:'avery', :'blake']::uuid[]);
select is(public.sub_job_closeout_fingerprint(:'job'), :'fp'::jsonb, 'editing the address, date or notes keeps the fingerprint');

-- Someone swaps the crew while the office is reviewing.
select public.update_sub_job(:'job', :'gc', current_date, '1 Example Road', null, array[:'avery', :'casey']::uuid[]);
select throws_ok(format($$ select public.complete_sub_job(%L, 20, 6, %L) $$, :'job', :'fp'), 'P0001', 'work changed during review',
  'a close with crew edited mid-review is refused');
select is(pg_temp.close_with(:'job', :'fp'), 'stale_review:crew', 'the refusal says the crew changed');
reset role;
select is((select status from public.sub_jobs where id = :'job'), 'scheduled', 'a refused close leaves the job scheduled');
select is((select count(*)::int from public.sub_invoices where job_id = :'job'), 0, 'a refused close issues no invoice');
select is((select count(*)::int from public.sub_job_crew where job_id = :'job' and pay_cents is not null), 0, 'a refused close stores no crew pay');
select is((select count(*)::int from public.outbox_messages where kind = 'sub_invoice_issued'), 0, 'a refused close queues no email');

-- Each kind of change is named on its own, and several at once are all named.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.sub_job_closeout_fingerprint(:'job') as fp \gset
select public.add_sub_job_extra(:'job', 'Plywood sheet', 2, 4500, 1500);
select is(pg_temp.close_with(:'job', :'fp'), 'stale_review:extras', 'an added extra is named');
select public.sub_job_closeout_fingerprint(:'job') as fp \gset
update public.sub_settings set crew_cents_per_sq = 5500 where company_id = :'company';
select is(pg_temp.close_with(:'job', :'fp'), 'stale_review:rates', 'a crew rate change is named');
select public.sub_job_closeout_fingerprint(:'job') as fp \gset
update public.sub_contractors set billing_email = 'billing@example.com' where id = :'gc';
select is(pg_temp.close_with(:'job', :'fp'), 'stale_review:contractor', 'a new billing email is named');
select public.sub_job_closeout_fingerprint(:'job') as fp \gset
update public.sub_contractors set cents_per_sq = 9000 where id = :'gc';
select public.update_sub_job(:'job', :'gc', current_date, '1 Example Road', null, array[:'avery', :'blake', :'casey']::uuid[]);
select is(pg_temp.close_with(:'job', :'fp'), 'stale_review:crew,rates', 'several changes are all named');
-- A fingerprint from an older app build, or a tampered one, is refused too.
select is(pg_temp.close_with(:'job', '{"crew": "x"}'::jsonb), 'stale_review:contractor,crew,extras,rates', 'a partial fingerprint is refused');

-- Reviewing again with the current numbers closes the job.
select public.sub_job_closeout_fingerprint(:'job') as fp \gset
select is(pg_temp.close_with(:'job', :'fp'), 'closed', 'a fresh review closes the job');
select is(pg_temp.close_with(:'job', :'fp'), ':job is already done', 'the same review cannot close it twice');
reset role;
select is((select count(*)::int from public.sub_invoices where job_id = :'job'), 1, 'exactly one invoice is issued');

-- Rollout: the app deployed before this migration sends no fingerprint and still closes.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_sub_job(:'gc', current_date, '2 Example Road', null, array[:'avery']::uuid[]) as job2 \gset
select isnt(public.complete_sub_job(:'job2', 10, 4), null, 'a close without a fingerprint still works');
reset role;

-- Only this company's staff can read a job's fingerprint.
select tests.act_as('00000000-0000-0000-0000-000000000009');
select throws_ok(format($$ select public.sub_job_closeout_fingerprint(%L) $$, :'job2'), 'P0002', 'job not found',
  'another company cannot fingerprint the job');
reset role;

select * from finish();
rollback;
