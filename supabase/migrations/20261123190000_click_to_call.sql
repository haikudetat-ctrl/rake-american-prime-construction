-- Calling out from the business number (Nov 23).
--
-- Chris: Andrey should be able to call customers back from the business line,
-- not his own cell. A Call button on the lead page rings his phone, he presses
-- 1, and Twilio dials the customer with the business number as caller ID.
--
-- Outbound calls go in phone_calls like inbound ones, so they show on the lead
-- and in the call log. from_number stays "the other party" (the customer) and
-- to_number the business number, whichever way the call went.

alter table public.phone_calls
  add column direction text not null default 'in' check (direction in ('in', 'out')),
  add column placed_by uuid references auth.users(id);

-- Closes an outbound call once: answered with its length, or not connected.
-- Called when the customer leg ends and again when the whole call ends; only
-- the first call does anything.
create function public.finish_outbound_call(p_call_sid text, p_answered boolean, p_duration_seconds int)
returns void
language sql security definer set search_path = '' as $$
  update public.phone_calls set
    status = case when p_answered then 'answered' else 'missed' end,
    duration_seconds = p_duration_seconds,
    ended_at = now()
  where call_sid = p_call_sid and direction = 'out' and status = 'ringing';
$$;

revoke execute on function public.finish_outbound_call(text, boolean, int) from public, anon, authenticated;
grant execute on function public.finish_outbound_call(text, boolean, int) to service_role;
