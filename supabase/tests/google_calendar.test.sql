-- Google Calendar sync queue (Nov 23): what queues a "calendar" outbox message, and when.
begin;
\ir support/fixtures.sql
select plan(10);

select id as company from public.companies where slug = 'american-prime' \gset

insert into public.sub_contractors (company_id, name, cents_per_sq) values (:'company', 'Example GC', 9500) returning id as gc \gset
insert into public.sub_workers (company_id, name) values (:'company', 'Avery') returning id as avery \gset
insert into public.customers (company_id, name) values (:'company', 'Calendar Customer') returning id as customer \gset
insert into public.sites (company_id, customer_id, address) values (:'company', :'customer', '9 Bay Rd, Ventnor City, NJ')
returning id as site \gset

create temp view calendar_queue as
  select payload ->> 'kind' as kind, payload ->> 'id' as id, status from public.outbox_messages where channel = 'calendar';

-- Not connected: nothing queues ---------------------------------------------------------------
insert into public.sub_jobs (company_id, contractor_id, work_date, address)
values (:'company', :'gc', current_date + 2, '12 Oak St, Trenton, NJ') returning id as job \gset
select is((select count(*)::int from calendar_queue), 0, 'nothing queues before Google Calendar is connected');

-- Connected ---------------------------------------------------------------------------------------
insert into public.google_calendar_connections (company_id, google_email, calendar_id, refresh_token_enc)
values (:'company', 'owner@example.com', 'cal-1', 'sealed');

update public.sub_jobs set work_date = current_date + 3 where id = :'job';
select is((select count(*)::int from calendar_queue where kind = 'sub_job' and id = :'job'), 1, 'moving a job queues its sync');

update public.sub_jobs set notes = 'Bring the long ladder' where id = :'job';
select is((select count(*)::int from calendar_queue where kind = 'sub_job' and id = :'job'), 1,
  'a second change while one sync is waiting adds nothing: the sync reads the job as it is');

update public.outbox_messages set status = 'sending' where channel = 'calendar' and payload ->> 'id' = :'job';
update public.sub_jobs set address = '14 Oak St, Trenton, NJ' where id = :'job';
select is((select count(*)::int from calendar_queue where kind = 'sub_job' and id = :'job'), 2,
  'a change during a sync queues another, since that one may have read the old job');

insert into public.sub_jobs (company_id, contractor_id, work_date, address)
values (:'company', :'gc', current_date + 5, '1 Pine St, Trenton, NJ') returning id as job2 \gset
delete from public.outbox_messages where channel = 'calendar' and payload ->> 'id' = :'job2';
insert into public.sub_job_crew (company_id, job_id, worker_id) values (:'company', :'job2', :'avery');
select is((select count(*)::int from calendar_queue where kind = 'sub_job' and id = :'job2'), 1, 'changing the crew queues the job');

-- Dumpster stops ---------------------------------------------------------------------------------
select app.create_rental_internal(:'company', :'customer', :'site', current_date + 1, null, null, null, null) as rental \gset
select id as drop_stop from public.stops where rental_id = :'rental' and kind = 'drop' \gset
select is((select count(*)::int from calendar_queue where kind = 'stop' and id = :'drop_stop'), 1, 'booking a rental queues its drop');

insert into public.stops (company_id, rental_id, kind, scheduled_date, status, sequence)
values (:'company', :'rental', 'dump', current_date + 4, 'scheduled', 1) returning id as dump_stop \gset
select is((select count(*)::int from calendar_queue where id = :'dump_stop'), 0, 'a dump run stays off the calendar');

-- Backfill on connect -------------------------------------------------------------------------------
delete from public.outbox_messages where channel = 'calendar';
update public.sub_jobs set status = 'void', void_reason = 'test' where id = :'job2';
delete from public.outbox_messages where channel = 'calendar';
select is(public.calendar_backfill(:'company'), 2, 'backfill queues the open job and the drop, not the voided job');
select is((select count(*)::int from calendar_queue), 2, 'and they are in the queue');

-- Staff can't reach the stored sign-in ----------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok($$ select refresh_token_enc from public.google_calendar_connections $$, '42501', null,
  'not even an owner can read the stored Google sign-in');
reset role;

select * from finish();
rollback;
