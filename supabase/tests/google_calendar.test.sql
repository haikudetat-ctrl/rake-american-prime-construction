-- Google Calendar sync queue (Nov 23): what queues a "calendar" outbox message, and when.
begin;
\ir support/fixtures.sql
select plan(15);

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

-- Homeowner roofing -----------------------------------------------------------------------------------
insert into public.leads (id, company_id, brand_id, source, name, phone, address)
select '00000000-0000-0000-0000-0000000000c1', :'company', b.id, 'office', 'Pat', '+16095550100', '5 Shore Rd, Brigantine, NJ'
from public.brands b where b.company_id = :'company' and b.kind = 'roofing';
select is((select count(*)::int from calendar_queue where kind = 'appointment'), 0, 'a lead with no estimate visit stays off the calendar');
update public.leads set stage = 'appointment', appointment_at = now() + interval '2 days' where id = '00000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from calendar_queue where kind = 'appointment' and id = '00000000-0000-0000-0000-0000000000c1'), 1,
  'setting an estimate visit queues it');

insert into public.catalog_versions (id, company_id, version, data, needs_confirmation, is_active)
values ('00000000-0000-0000-0000-0000000000c2', :'company', 99, '{}', false, false);
insert into public.proposals (id, company_id, lead_id, number, catalog_version_id, needs_confirmation, measurement, inputs, options, addons)
values ('00000000-0000-0000-0000-0000000000c3', :'company', '00000000-0000-0000-0000-0000000000c1', 9001,
        '00000000-0000-0000-0000-0000000000c2', false, '{}', '{}', '[]', '[]');
insert into public.roofing_jobs (id, company_id, lead_id, proposal_id, customer_name, system_name, scope, total_cents)
values ('00000000-0000-0000-0000-0000000000c4', :'company', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000c3', 'Pat', 'GAF Timberline HDZ', '{}', 2000000);
select is((select count(*)::int from calendar_queue where kind = 'roofing_job'), 0, 'a roof install with no date yet stays off');
update public.roofing_jobs set install_date = current_date + 6 where id = '00000000-0000-0000-0000-0000000000c4';
select is((select count(*)::int from calendar_queue where kind = 'roofing_job' and id = '00000000-0000-0000-0000-0000000000c4'), 1,
  'scheduling a roof install queues it');
update public.roofing_jobs set install_date = null where id = '00000000-0000-0000-0000-0000000000c4';
update public.outbox_messages set status = 'sent' where channel = 'calendar';
update public.roofing_jobs set notes = 'still unscheduled' where id = '00000000-0000-0000-0000-0000000000c4';
select is((select count(*)::int from calendar_queue where kind = 'roofing_job' and status = 'pending'), 0,
  'an unscheduled install that was never on the calendar queues nothing');
update public.roofing_jobs set install_date = current_date + 6 where id = '00000000-0000-0000-0000-0000000000c4';

-- Backfill on connect -------------------------------------------------------------------------------
delete from public.outbox_messages where channel = 'calendar';
update public.sub_jobs set status = 'void', void_reason = 'test' where id = :'job2';
delete from public.outbox_messages where channel = 'calendar';
select is(public.calendar_backfill(:'company'), 4,
  'backfill queues the open job, the drop, the roof install and the estimate visit, not the voided job');
select is((select count(*)::int from calendar_queue), 4, 'and they are in the queue');

-- Staff can't reach the stored sign-in ----------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok($$ select refresh_token_enc from public.google_calendar_connections $$, '42501', null,
  'not even an owner can read the stored Google sign-in');
reset role;

select * from finish();
rollback;
