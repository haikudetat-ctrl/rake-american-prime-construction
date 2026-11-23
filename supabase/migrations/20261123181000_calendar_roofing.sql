-- Homeowner roofing on Google Calendar (Nov 23).
--
-- google_calendar put crew jobs for other contractors and dumpster drops and
-- pickups on the "Rake jobs" calendar, but nothing from homeowner roofing.
-- Chris asked for all three businesses there. Now also:
--   roofing_job   a homeowner roof install, all day on its install date;
--   appointment   an estimate visit on a lead, an hour at its set time.
-- Same queue and rules as before: nothing queues until a calendar is
-- connected, and one waiting sync per item.

create function app.roofing_job_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.install_date is not null or (tg_op = 'UPDATE' and old.install_date is not null) then
    perform app.queue_calendar(new.company_id, 'roofing_job', new.id);
  end if;
  return null;
end;
$$;
create trigger roofing_jobs_calendar after insert or update of install_date, status, address, crew_ids, notes
  on public.roofing_jobs for each row execute function app.roofing_job_calendar();

-- Only leads that have, or just lost, an estimate visit.
create function app.lead_appointment_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.appointment_at is not null or (tg_op = 'UPDATE' and old.appointment_at is not null) then
    perform app.queue_calendar(new.company_id, 'appointment', new.id);
  end if;
  return null;
end;
$$;
create trigger leads_appointment_calendar after insert or update of appointment_at, stage, name, phone, address, notes
  on public.leads for each row execute function app.lead_appointment_calendar();

create or replace function public.calendar_backfill(p_company_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_from date := app.company_today(p_company_id) - 7;
  v_count int := 0;
  v_id uuid;
begin
  for v_id in
    select id from public.sub_jobs where company_id = p_company_id and work_date >= v_from and status <> 'void'
  loop
    perform app.queue_calendar(p_company_id, 'sub_job', v_id);
    v_count := v_count + 1;
  end loop;
  for v_id in
    select id from public.stops
    where company_id = p_company_id and kind in ('drop', 'pickup') and scheduled_date >= v_from and status <> 'cancelled'
  loop
    perform app.queue_calendar(p_company_id, 'stop', v_id);
    v_count := v_count + 1;
  end loop;
  for v_id in
    select id from public.roofing_jobs where company_id = p_company_id and install_date >= v_from
  loop
    perform app.queue_calendar(p_company_id, 'roofing_job', v_id);
    v_count := v_count + 1;
  end loop;
  for v_id in
    select id from public.leads
    where company_id = p_company_id and stage <> 'lost' and appointment_at >= v_from::timestamptz
  loop
    perform app.queue_calendar(p_company_id, 'appointment', v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function app.roofing_job_calendar(), app.lead_appointment_calendar() from public, anon, authenticated;
revoke execute on function public.calendar_backfill(uuid) from public, anon, authenticated;
grant execute on function public.calendar_backfill(uuid) to service_role;
