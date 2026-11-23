-- Google Calendar (Nov 23).
--
-- Andrey: "The jobs that are scheduled are not being shown in the google
-- calendar ... if that's possible it will be freaking great."
--
-- One way, Rake to Google. An owner connects their Google account once from
-- Settings; Rake makes a calendar of its own there ("Rake jobs") and keeps it
-- in step with the schedule: crew jobs on their work day, dumpster drops and
-- pickups on theirs, each an all-day event that moves when the job moves and
-- disappears when it's cancelled. Rake stays the source of truth; an edit made
-- in Google is overwritten by the next change in Rake.
--
-- Changes queue a sync on the outbox's new "calendar" channel, so a slow or
-- failing Google never holds up the office, and failures retry with backoff
-- like any other message. Nothing is queued until a connection exists.

create table public.google_calendar_connections (
  company_id uuid primary key references public.companies(id),
  google_email text,
  calendar_id text not null,
  -- AES-256-GCM under GOOGLE_TOKEN_KEY, like the QuickBooks tokens.
  refresh_token_enc text not null,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text
);
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from anon, authenticated;
grant all on public.google_calendar_connections to service_role;

alter table public.outbox_messages drop constraint outbox_messages_channel_check;
alter table public.outbox_messages add constraint outbox_messages_channel_check
  check (channel in ('sms', 'email', 'calendar'));

-- One waiting sync per item is enough: it reads the item as it stands when it
-- runs. One already being sent doesn't count, since it may have read the item
-- before this change.
create function app.queue_calendar(p_company_id uuid, p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.google_calendar_connections where company_id = p_company_id) then
    return;
  end if;
  if exists (
    select 1 from public.outbox_messages
    where channel = 'calendar' and status in ('pending', 'failed')
      and payload ->> 'kind' = p_kind and payload ->> 'id' = p_id::text
  ) then
    return;
  end if;
  perform app.enqueue(p_company_id, 'calendar', 'calendar_sync', jsonb_build_object('kind', p_kind, 'id', p_id));
end;
$$;

create function app.sub_job_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.queue_calendar(new.company_id, 'sub_job', new.id);
  return null;
end;
$$;
create trigger sub_jobs_calendar after insert or update of work_date, address, status, contractor_id, notes
  on public.sub_jobs for each row execute function app.sub_job_calendar();

-- The crew is in the event's description.
create function app.sub_job_crew_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform app.queue_calendar(old.company_id, 'sub_job', old.job_id);
  else
    perform app.queue_calendar(new.company_id, 'sub_job', new.job_id);
  end if;
  return null;
end;
$$;
create trigger sub_job_crew_calendar after insert or delete on public.sub_job_crew
  for each row execute function app.sub_job_crew_calendar();

-- Drops and pickups; the trip to the dump isn't something to plan around.
create function app.stop_calendar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('drop', 'pickup') then
    perform app.queue_calendar(new.company_id, 'stop', new.id);
  end if;
  return null;
end;
$$;
create trigger stops_calendar after insert or update of scheduled_date, status, driver_id
  on public.stops for each row execute function app.stop_calendar();

-- Right after connecting: everything from a week ago on, so the calendar
-- starts full rather than filling in as things change.
create function public.calendar_backfill(p_company_id uuid) returns int
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
  return v_count;
end;
$$;

revoke execute on function
  app.queue_calendar(uuid, text, uuid), app.sub_job_calendar(), app.sub_job_crew_calendar(), app.stop_calendar()
from public, anon, authenticated;
revoke execute on function public.calendar_backfill(uuid) from public, anon, authenticated;
grant execute on function public.calendar_backfill(uuid) to service_role;
