-- Slice 2: correcting mistakes.
--
-- Every correction is a workflow function, like the forward steps: it checks
-- the caller's role, refuses anything that would change money already on a
-- statement, and moves the can, the stops and the invoice together. The
-- audit triggers record who did it and what the rows looked like before.
--
-- Money on an issued statement is never edited in place. To fix it, an owner
-- voids the statement (only while nothing has been paid against it), which
-- returns its invoices to "ready to bill"; the fix is made and the invoice
-- goes out on the next statement.

alter table public.invoices add column void_reason text;
alter table public.rentals add column cancel_reason text;
alter table public.statements add column void_reason text;

-- Undoing a drop deletes the draft invoice it opened, so record deletions too.
create trigger invoices_audit_delete after delete on public.invoices
  for each row execute function app.audit();
create trigger scale_tickets_audit after insert or update or delete on public.scale_tickets
  for each row execute function app.audit();
create trigger stops_audit after insert or update or delete on public.stops
  for each row execute function app.audit();

create function app.require_owner() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner() then
    raise exception 'only an owner can do that' using errcode = '42501';
  end if;
  return app.current_company_id();
end;
$$;

-- The invoice for a rental, locked, refusing once it is on a statement.
create function app.lock_open_invoice(p_rental_id uuid) returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where rental_id = p_rental_id for update;
  if v_invoice.id is not null and v_invoice.status in ('on_statement', 'paid') then
    raise exception 'invoice #% is already on a statement; void the statement first', v_invoice.number;
  end if;
  return v_invoice;
end;
$$;

-- Rentals -----------------------------------------------------------------------

-- Before the drop only. After a drop, the can is on a job: pick it up instead.
create function public.cancel_rental(p_rental_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  update public.rentals set status = 'cancelled', cancel_reason = nullif(p_reason, '')
  where id = p_rental_id and company_id = v_company and status = 'scheduled';
  if not found then raise exception 'only a rental that has not been dropped can be cancelled'; end if;

  update public.stops set status = 'cancelled'
  where rental_id = p_rental_id and status = 'scheduled';
  perform app.emit(v_company, 'rental', p_rental_id, 'rental_cancelled', jsonb_build_object('reason', p_reason));
end;
$$;

-- Moving a drop also moves the rental's requested date, so the board and the
-- customer page agree with the run.
create or replace function public.assign_stop(p_stop_id uuid, p_driver_id uuid, p_date date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_stop public.stops;
begin
  if p_driver_id is not null and not exists (
    select 1 from public.memberships
    where user_id = p_driver_id and company_id = v_company and is_active and role in ('driver', 'owner', 'office')
  ) then
    raise exception 'driver is not on this team';
  end if;
  update public.stops set driver_id = p_driver_id, scheduled_date = p_date
  where id = p_stop_id and company_id = v_company and status = 'scheduled'
  returning * into v_stop;
  if v_stop.id is null then raise exception 'stop not found or already done'; end if;
  if v_stop.kind = 'drop' then
    update public.rentals set requested_drop_date = p_date where id = v_stop.rental_id;
  end if;
end;
$$;

-- The driver recorded the wrong can. Puts the recorded one back in the yard.
create function public.swap_can(p_rental_id uuid, p_can_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_rental public.rentals;
begin
  select * into v_rental from public.rentals
  where id = p_rental_id and company_id = v_company for update;
  if v_rental.id is null then raise exception 'rental not found'; end if;
  if v_rental.status not in ('on_site', 'pickup_requested') then
    raise exception 'the can can only be changed while it is on the job';
  end if;
  if v_rental.can_id = p_can_id then return; end if;

  update public.cans set status = 'on_site'
  where id = p_can_id and company_id = v_company and status = 'available';
  if not found then raise exception 'that can is not in the yard'; end if;
  update public.cans set status = 'available' where id = v_rental.can_id;
  update public.rentals set can_id = p_can_id where id = v_rental.id;

  perform app.emit(v_company, 'rental', v_rental.id, 'can_swapped',
    jsonb_build_object('from', v_rental.can_id, 'to', p_can_id));
end;
$$;

-- Undo the most recent driver step on a rental (owner only). Reverses exactly
-- what complete_stop / record_scale_ticket did, and refuses once the invoice
-- is on a statement or a later step has happened.
create function public.undo_stop(p_stop_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_stop public.stops;
  v_rental public.rentals;
  v_invoice public.invoices;
begin
  select * into v_stop from public.stops where id = p_stop_id and company_id = v_company for update;
  if v_stop.id is null then raise exception 'stop not found'; end if;
  if v_stop.status <> 'done' then raise exception 'that stop has not been completed'; end if;

  select * into v_rental from public.rentals where id = v_stop.rental_id for update;
  v_invoice := app.lock_open_invoice(v_rental.id);

  -- Steps undo newest first; the rental's status says which step is newest.
  if (v_stop.kind = 'drop' and v_rental.status in ('picked_up', 'closed'))
     or (v_stop.kind = 'pickup' and v_rental.status = 'closed') then
    raise exception 'undo the later step first';
  end if;

  if v_stop.kind = 'drop' then
    if v_rental.status <> 'on_site' then
      raise exception 'a pickup is already scheduled; cancel it from the rental page first';
    end if;
    if v_invoice.status = 'void' then raise exception 'the invoice was voided; this drop cannot be undone'; end if;
    update public.cans set status = 'available' where id = v_rental.can_id;
    update public.rentals set status = 'scheduled', can_id = null, dropped_at = null where id = v_rental.id;
    delete from public.invoices where id = v_invoice.id;

  elsif v_stop.kind = 'pickup' then
    if v_rental.status <> 'picked_up' then raise exception 'rental is %', v_rental.status; end if;
    update public.stops set status = 'cancelled'
    where rental_id = v_rental.id and kind = 'dump' and status = 'scheduled';
    update public.cans set status = 'on_site' where id = v_rental.can_id;
    update public.rentals set status = 'pickup_requested', picked_up_at = null where id = v_rental.id;
    delete from public.invoice_lines where invoice_id = v_invoice.id and kind = 'extended_days';

  else -- dump
    if v_rental.status <> 'closed' then raise exception 'rental is %', v_rental.status; end if;
    if exists (select 1 from public.cans where id = v_rental.can_id and status <> 'available') then
      raise exception 'that can has already gone out on another job';
    end if;
    delete from public.scale_tickets where rental_id = v_rental.id;
    delete from public.invoice_lines where invoice_id = v_invoice.id and kind = 'tonnage';
    update public.invoices set status = 'draft', finalized_at = null
    where id = v_invoice.id and status = 'final';
    update public.cans set status = 'in_transit' where id = v_rental.can_id;
    update public.rentals set status = 'picked_up', dumped_at = null where id = v_rental.id;
  end if;

  update public.stops set status = 'scheduled', completed_at = null, completed_by = null where id = v_stop.id;
  perform app.emit(v_company, 'rental', v_rental.id, v_stop.kind || '_undone', jsonb_build_object('stop_id', v_stop.id));
end;
$$;

-- A pickup scheduled by mistake: put the rental back to "on the job".
create function public.cancel_pickup(p_rental_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  update public.rentals set status = 'on_site'
  where id = p_rental_id and company_id = v_company and status = 'pickup_requested';
  if not found then raise exception 'no pickup is waiting for this rental'; end if;
  update public.stops set status = 'cancelled'
  where rental_id = p_rental_id and kind = 'pickup' and status = 'scheduled';
end;
$$;

-- Grants for the helpers and rental corrections above.
revoke execute on function
  app.require_owner(), app.lock_open_invoice(uuid)
  from public, anon, authenticated;
grant execute on function app.require_owner(), app.lock_open_invoice(uuid) to service_role;

revoke execute on function
  public.cancel_rental(uuid, text), public.swap_can(uuid, uuid), public.undo_stop(uuid),
  public.cancel_pickup(uuid)
  from public, anon;
grant execute on function
  public.cancel_rental(uuid, text), public.swap_can(uuid, uuid), public.undo_stop(uuid),
  public.cancel_pickup(uuid)
  to authenticated, service_role;
