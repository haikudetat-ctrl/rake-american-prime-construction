-- Slice 2 (continued): invoice and statement corrections. See the previous
-- migration for the rules: nothing on a statement is edited in place.

-- Invoices ----------------------------------------------------------------------

-- A credit (negative) or extra charge (positive) with a reason, before billing.
create function public.add_invoice_adjustment(p_invoice_id uuid, p_description text, p_amount_cents int)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_invoice public.invoices;
begin
  if coalesce(trim(p_description), '') = '' then raise exception 'say what the adjustment is for'; end if;
  if p_amount_cents = 0 then raise exception 'enter an amount'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company;
  if v_invoice.id is null then raise exception 'invoice not found'; end if;
  v_invoice := app.lock_open_invoice(v_invoice.rental_id);
  if v_invoice.status = 'void' then raise exception 'invoice is void'; end if;

  insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
  values (v_company, v_invoice.id, 'adjustment', trim(p_description), 1, p_amount_cents, p_amount_cents);
  if (select total_cents from public.invoices where id = v_invoice.id) < 0 then
    raise exception 'an invoice cannot go below zero';
  end if;
end;
$$;

create function public.remove_invoice_adjustment(p_line_id uuid)
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

-- Owner only. The rental and its history stay; the invoice will never bill.
create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_invoice public.invoices;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'give a reason for voiding'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company;
  if v_invoice.id is null then raise exception 'invoice not found'; end if;
  perform app.lock_open_invoice(v_invoice.rental_id);
  update public.invoices set status = 'void', void_reason = trim(p_reason) where id = v_invoice.id;
  perform app.emit(v_company, 'invoice', v_invoice.id, 'invoice_voided', jsonb_build_object('reason', p_reason));
end;
$$;

-- Owner only, and only while nothing has been paid against it. Its invoices go
-- back to "ready to bill" and are picked up by the next statement run.
create function public.void_statement(p_statement_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_statement public.statements;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'give a reason for voiding'; end if;
  select * into v_statement from public.statements
  where id = p_statement_id and company_id = v_company for update;
  if v_statement.id is null then raise exception 'statement not found'; end if;
  if v_statement.status <> 'open' then raise exception 'statement is %', v_statement.status; end if;
  if exists (select 1 from public.payments where statement_id = v_statement.id) then
    raise exception 'a payment has been recorded against this statement';
  end if;

  update public.statements set status = 'void', void_reason = trim(p_reason) where id = v_statement.id;
  update public.invoices set status = 'final', statement_id = null where statement_id = v_statement.id;
  -- Reminders for a void statement must not go out.
  update public.outbox_messages set status = 'sent', last_error = 'skipped: statement voided'
  where status in ('pending', 'failed') and payload ->> 'statement_id' = v_statement.id::text;
  perform app.emit(v_company, 'statement', v_statement.id, 'statement_voided', jsonb_build_object('reason', p_reason));
end;
$$;

-- Grants ------------------------------------------------------------------------

revoke execute on function
  public.add_invoice_adjustment(uuid, text, int), public.remove_invoice_adjustment(uuid),
  public.void_invoice(uuid, text), public.void_statement(uuid, text)
  from public, anon;
grant execute on function
  public.add_invoice_adjustment(uuid, text, int), public.remove_invoice_adjustment(uuid),
  public.void_invoice(uuid, text), public.void_statement(uuid, text)
  to authenticated, service_role;
