-- Finish applying the Slice 2 migration (paste into the Supabase SQL editor and run once).
-- Everything else from 20261015120000/…01 is already live; these two functions
-- contain DELETE statements, which Supabase's agent tool won't run without an
-- approval prompt. The last lines record both migrations in the history so
-- `supabase db push` won't try to apply them again.

create or replace function public.undo_stop(p_stop_id uuid)
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

create or replace function public.remove_invoice_adjustment(p_line_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_line public.invoice_lines;
  v_invoice public.invoices;
begin
  select * into v_line from public.invoice_lines where id = p_line_id and company_id = v_company;
  if v_line.id is null or v_line.kind <> 'adjustment' then raise exception 'adjustment not found'; end if;
  select * into v_invoice from public.invoices where id = v_line.invoice_id;
  perform app.lock_open_invoice(v_invoice.rental_id);
  delete from public.invoice_lines where id = v_line.id;
  if (select total_cents from public.invoices where id = v_invoice.id) < 0 then
    raise exception 'an invoice cannot go below zero';
  end if;
end;
$$;

revoke execute on function public.undo_stop(uuid), public.remove_invoice_adjustment(uuid) from public, anon;
grant execute on function public.undo_stop(uuid), public.remove_invoice_adjustment(uuid) to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261015120000', 'corrections_rentals'), ('20261015120001', 'corrections_invoices')
on conflict (version) do nothing;

select 'slice 2 migration complete' as result;
