-- Quick invoices: a one-off branded invoice typed in the office. Custom lines,
-- or lines picked from a price list Rake already keeps, a bill-to typed in or
-- filled from a customer, contractor or lead, and the brand it goes out under.
--
-- Deliberately separate from the dumpster invoices (one per rental, billed on
-- the Monday statement) and the contractor invoices (one per subcontract job,
-- on crew pay and the weekly statement): a quick invoice is on no statement
-- and pays no crew. It shares their number sequence, so no two American Prime
-- invoices ever carry the same number.
--
-- Saved as a draft first (editable, with a PDF preview), then issued. Issuing
-- can email it, held 15 minutes like a contractor invoice so a typo can be
-- voided before it goes. Staff only; every write goes through the functions
-- below, so the totals are always the database's own arithmetic.

create table public.quick_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  brand_id uuid not null references public.brands(id),
  number int not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'paid', 'void')),
  bill_to_name text not null check (length(trim(bill_to_name)) between 1 and 200),
  bill_to_email text check (bill_to_email is null or bill_to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  bill_to_phone text,
  bill_to_address text,
  -- Where the bill-to was filled from, if anywhere. The typed fields are what prints.
  customer_id uuid references public.customers(id),
  contractor_id uuid references public.sub_contractors(id),
  lead_id uuid references public.leads(id),
  issued_on date,
  due_on date not null,
  memo text check (memo is null or length(memo) <= 2000),
  tax_pct numeric(6, 3) not null default 0 check (tax_pct between 0 and 20),
  subtotal_cents int not null default 0,
  tax_cents int not null default 0,
  total_cents int not null default 0 check (total_cents >= 0),
  void_reason text,
  -- The latest email asked for, and when it leaves (after the hold).
  email_queued_to text,
  email_queued_for timestamptz,
  sent_at timestamptz,
  sent_to text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index quick_invoices_open_idx on public.quick_invoices(company_id, due_on) where status = 'open';
create trigger quick_invoices_touch before update on public.quick_invoices for each row execute function app.touch_updated_at();

create table public.quick_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.quick_invoices(id) on delete cascade,
  position int not null,
  description text not null check (length(trim(description)) between 1 and 300),
  quantity numeric(10, 2) not null check (quantity > 0),
  unit text check (unit is null or length(unit) <= 20),
  -- Negative only for a typed credit or discount line.
  unit_cents int not null check (unit_cents between -10000000 and 10000000),
  amount_cents int not null,
  -- Picked from a price list: which one and which item, priced when picked.
  source text not null default 'custom' check (source in ('custom', 'dumpster_price', 'sub_price')),
  source_item_id uuid,
  unique (invoice_id, position)
);

create table public.quick_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.quick_invoices(id),
  amount_cents int not null check (amount_cents > 0),
  method text not null check (method in ('check', 'ach', 'cash', 'card', 'other')),
  reference text,
  received_on date not null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index quick_invoice_payments_invoice_idx on public.quick_invoice_payments(invoice_id) where voided_at is null;

create trigger quick_invoices_audit after insert or update on public.quick_invoices for each row execute function app.audit();
create trigger quick_invoice_lines_audit after insert or update or delete on public.quick_invoice_lines for each row execute function app.audit();
create trigger quick_invoice_payments_audit after insert or update on public.quick_invoice_payments for each row execute function app.audit();

-- RLS: staff read; nobody writes directly. -----------------------------------------------

alter table public.quick_invoices enable row level security;
alter table public.quick_invoice_lines enable row level security;
alter table public.quick_invoice_payments enable row level security;

revoke all on public.quick_invoices, public.quick_invoice_lines, public.quick_invoice_payments from anon, authenticated;
grant select on public.quick_invoices, public.quick_invoice_lines, public.quick_invoice_payments to authenticated;
grant all on public.quick_invoices, public.quick_invoice_lines, public.quick_invoice_payments to service_role;

create policy quick_invoices_staff_read on public.quick_invoices for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy quick_invoice_lines_staff_read on public.quick_invoice_lines for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy quick_invoice_payments_staff_read on public.quick_invoice_payments for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Helpers ----------------------------------------------------------------------------------

create function app.staff_quick_invoice(p_invoice_id uuid) returns public.quick_invoices
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.quick_invoices;
begin
  select * into v_invoice from public.quick_invoices
  where id = p_invoice_id and company_id = app.require_staff() for update;
  if v_invoice.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  return v_invoice;
end;
$$;

-- Saving -----------------------------------------------------------------------------------

-- Creates a draft (p_invoice_id null) or replaces a draft's contents. p_invoice:
--   { brand_id, bill_to: { name, email, phone, address }, customer_id, contractor_id,
--     lead_id, due_on, memo, tax_pct,
--     lines: [{ description, quantity, unit, unit_cents, source, source_item_id }] }
-- The number is taken when the draft is first saved, like a dumpster invoice.
create function public.save_quick_invoice(p_invoice_id uuid, p_invoice jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_invoice public.quick_invoices;
  v_id uuid;
  v_bill jsonb := coalesce(p_invoice -> 'bill_to', '{}');
  v_lines jsonb := coalesce(p_invoice -> 'lines', '[]');
  v_brand uuid := nullif(p_invoice ->> 'brand_id', '')::uuid;
  v_customer uuid := nullif(p_invoice ->> 'customer_id', '')::uuid;
  v_contractor uuid := nullif(p_invoice ->> 'contractor_id', '')::uuid;
  v_lead uuid := nullif(p_invoice ->> 'lead_id', '')::uuid;
  v_name text := nullif(trim(coalesce(v_bill ->> 'name', '')), '');
  v_email text := nullif(lower(trim(coalesce(v_bill ->> 'email', ''))), '');
  v_due date := nullif(p_invoice ->> 'due_on', '')::date;
  v_tax numeric := coalesce(nullif(p_invoice ->> 'tax_pct', '')::numeric, 0);
  v_line jsonb;
  v_i int := 0;
  v_qty numeric;
  v_unit int;
  v_source text;
  v_item uuid;
  v_subtotal int := 0;
  v_tax_cents int;
begin
  if v_name is null then raise exception 'enter who the invoice is for'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that email doesn''t look right'; end if;
  if v_due is null then raise exception 'pick a due date'; end if;
  if v_tax < 0 or v_tax > 20 then raise exception 'sales tax must be between 0%% and 20%%'; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then raise exception 'add at least one line'; end if;
  if jsonb_array_length(v_lines) > 50 then raise exception 'an invoice can have up to 50 lines'; end if;
  if not exists (select 1 from public.brands where id = v_brand and company_id = v_company) then
    raise exception 'pick the brand it goes out under' using errcode = 'P0002';
  end if;
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and company_id = v_company) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if v_contractor is not null and not exists (select 1 from public.sub_contractors where id = v_contractor and company_id = v_company) then
    raise exception 'contractor not found' using errcode = 'P0002';
  end if;
  if v_lead is not null and not exists (select 1 from public.leads where id = v_lead and company_id = v_company) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  if p_invoice_id is null then
    insert into public.quick_invoices (company_id, brand_id, number, bill_to_name, due_on, created_by)
    values (v_company, v_brand, app.next_number(v_company, 'invoice'), v_name, v_due, auth.uid())
    returning id into v_id;
  else
    v_invoice := app.staff_quick_invoice(p_invoice_id);
    if v_invoice.status <> 'draft' then
      raise exception 'invoice #% is already issued; void it and make a new one to change it', v_invoice.number;
    end if;
    v_id := v_invoice.id;
    delete from public.quick_invoice_lines where invoice_id = v_id;
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_i := v_i + 1;
    v_qty := nullif(v_line ->> 'quantity', '')::numeric;
    v_unit := nullif(v_line ->> 'unit_cents', '')::int;
    v_source := coalesce(nullif(v_line ->> 'source', ''), 'custom');
    v_item := nullif(v_line ->> 'source_item_id', '')::uuid;
    if nullif(trim(coalesce(v_line ->> 'description', '')), '') is null then raise exception 'line %: describe it', v_i; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'line %: enter a quantity above zero', v_i; end if;
    if v_qty <> round(v_qty, 2) then raise exception 'line %: quantity can have up to 2 decimals', v_i; end if;
    if v_unit is null then raise exception 'line %: enter a price', v_i; end if;
    if v_source not in ('custom', 'dumpster_price', 'sub_price') then raise exception 'line %: unknown price list', v_i; end if;
    if v_source = 'custom' then v_item := null;
    elsif v_item is null
      or (v_source = 'dumpster_price' and not exists (select 1 from public.dumpster_price_items where id = v_item and company_id = v_company))
      or (v_source = 'sub_price' and not exists (select 1 from public.sub_price_items where id = v_item and company_id = v_company)) then
      raise exception 'line %: that price list item is gone; pick it again or make it a custom item', v_i using errcode = 'P0002';
    end if;
    insert into public.quick_invoice_lines (company_id, invoice_id, position, description, quantity, unit, unit_cents, amount_cents, source, source_item_id)
    values (v_company, v_id, v_i, trim(v_line ->> 'description'), v_qty, nullif(trim(coalesce(v_line ->> 'unit', '')), ''),
            v_unit, round(v_qty * v_unit)::int, v_source, v_item);
    v_subtotal := v_subtotal + round(v_qty * v_unit)::int;
  end loop;

  if v_subtotal < 0 then raise exception 'credits can''t take the invoice below zero'; end if;
  v_tax_cents := round(v_subtotal * v_tax / 100)::int;

  update public.quick_invoices
  set brand_id = v_brand, bill_to_name = v_name, bill_to_email = v_email,
      bill_to_phone = nullif(trim(coalesce(v_bill ->> 'phone', '')), ''),
      bill_to_address = nullif(trim(coalesce(v_bill ->> 'address', '')), ''),
      customer_id = v_customer, contractor_id = v_contractor, lead_id = v_lead,
      due_on = v_due, memo = nullif(trim(coalesce(p_invoice ->> 'memo', '')), ''), tax_pct = v_tax,
      subtotal_cents = v_subtotal, tax_cents = v_tax_cents, total_cents = v_subtotal + v_tax_cents
  where id = v_id;

  perform app.emit(v_company, 'quick_invoice', v_id, case when p_invoice_id is null then 'quick_invoice_drafted' else 'quick_invoice_edited' end,
    jsonb_build_object('total_cents', v_subtotal + v_tax_cents, 'lines', v_i));
  return v_id;
end;
$$;

-- Issuing and sending ------------------------------------------------------------------------

-- The email is held 15 minutes so a typo can be voided before it leaves.
create function app.enqueue_quick_invoice_email(p_invoice public.quick_invoices, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_to text := nullif(lower(trim(coalesce(p_to, ''))), '');
begin
  if v_to is null or v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter an email address to send it to'; end if;
  perform app.enqueue(p_invoice.company_id, 'email', 'quick_invoice_issued',
    jsonb_build_object('invoice_id', p_invoice.id, 'to', v_to),
    'quick_invoice:' || p_invoice.id || ':' || extract(epoch from clock_timestamp())::bigint,
    now() + interval '15 minutes');
  update public.quick_invoices set email_queued_to = v_to, email_queued_for = now() + interval '15 minutes' where id = p_invoice.id;
end;
$$;

-- Draft to open. Issued today; the due date stays as set, but never before today.
create function public.issue_quick_invoice(p_invoice_id uuid, p_send_to text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.quick_invoices := app.staff_quick_invoice(p_invoice_id);
  v_today date := app.company_today(v_invoice.company_id);
begin
  if v_invoice.status <> 'draft' then raise exception 'invoice #% is already %', v_invoice.number, v_invoice.status; end if;
  if v_invoice.total_cents <= 0 then raise exception 'the invoice total is $0; add a line before issuing it'; end if;
  update public.quick_invoices
  set status = 'open', issued_on = v_today, due_on = greatest(due_on, v_today)
  where id = v_invoice.id
  returning * into v_invoice;
  if nullif(trim(coalesce(p_send_to, '')), '') is not null then
    perform app.enqueue_quick_invoice_email(v_invoice, p_send_to);
  end if;
  perform app.emit(v_invoice.company_id, 'quick_invoice', v_invoice.id, 'quick_invoice_issued',
    jsonb_build_object('number', v_invoice.number, 'total_cents', v_invoice.total_cents, 'emailed_to', nullif(lower(trim(coalesce(p_send_to, ''))), '')));
end;
$$;

-- Email an issued invoice (again, or for the first time).
create function public.send_quick_invoice(p_invoice_id uuid, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.quick_invoices := app.staff_quick_invoice(p_invoice_id);
begin
  if v_invoice.status not in ('open', 'paid') then raise exception 'invoice #% is %', v_invoice.number, v_invoice.status; end if;
  perform app.enqueue_quick_invoice_email(v_invoice, p_to);
end;
$$;

-- Staff can discard a draft; only an owner can void an issued invoice, and only
-- before any payment is recorded. The number stays used either way.
create function public.void_quick_invoice(p_invoice_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.quick_invoices := app.staff_quick_invoice(p_invoice_id);
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  if v_invoice.status = 'void' then raise exception 'invoice #% is already void', v_invoice.number; end if;
  if v_invoice.status <> 'draft' and not app.is_owner() then raise exception 'only an owner can void an issued invoice' using errcode = '42501'; end if;
  if exists (select 1 from public.quick_invoice_payments where invoice_id = v_invoice.id and voided_at is null) then
    raise exception 'invoice #% has a payment recorded; void the payment first', v_invoice.number;
  end if;
  update public.quick_invoices set status = 'void', void_reason = trim(p_reason) where id = v_invoice.id;
  perform app.emit(v_invoice.company_id, 'quick_invoice', v_invoice.id, 'quick_invoice_voided', jsonb_build_object('reason', trim(p_reason)));
end;
$$;

-- Payments -----------------------------------------------------------------------------------

create function public.record_quick_payment(
  p_invoice_id uuid, p_amount_cents int, p_method text, p_reference text, p_received_on date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.quick_invoices := app.staff_quick_invoice(p_invoice_id);
  v_paid int;
  v_id uuid;
begin
  if v_invoice.status <> 'open' then raise exception 'invoice #% is %', v_invoice.number, v_invoice.status; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount above zero'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.quick_invoice_payments where invoice_id = v_invoice.id and voided_at is null;
  if v_paid + p_amount_cents > v_invoice.total_cents then
    raise exception 'that is more than the % still owed', to_char((v_invoice.total_cents - v_paid) / 100.0, 'FM$999,999,990.00');
  end if;
  insert into public.quick_invoice_payments (company_id, invoice_id, amount_cents, method, reference, received_on, created_by)
  values (v_invoice.company_id, v_invoice.id, p_amount_cents, coalesce(nullif(p_method, ''), 'check'),
          nullif(trim(coalesce(p_reference, '')), ''), coalesce(p_received_on, app.company_today(v_invoice.company_id)), auth.uid())
  returning id into v_id;
  if v_paid + p_amount_cents = v_invoice.total_cents then
    update public.quick_invoices set status = 'paid' where id = v_invoice.id;
  end if;
  perform app.emit(v_invoice.company_id, 'quick_invoice', v_invoice.id, 'quick_payment_recorded',
    jsonb_build_object('amount_cents', p_amount_cents, 'number', v_invoice.number));
  return v_id;
end;
$$;

create function public.void_quick_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_payment public.quick_invoice_payments;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  select * into v_payment from public.quick_invoice_payments
  where id = p_payment_id and company_id = v_company and voided_at is null for update;
  if v_payment.id is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  update public.quick_invoice_payments set voided_at = now(), void_reason = trim(p_reason) where id = v_payment.id;
  update public.quick_invoices set status = 'open' where id = v_payment.invoice_id and status = 'paid';
end;
$$;

-- Grants ---------------------------------------------------------------------------------------

revoke execute on function app.staff_quick_invoice(uuid), app.enqueue_quick_invoice_email(public.quick_invoices, text)
  from public, anon, authenticated;
grant execute on function app.staff_quick_invoice(uuid), app.enqueue_quick_invoice_email(public.quick_invoices, text)
  to service_role;

revoke execute on function
  public.save_quick_invoice(uuid, jsonb), public.issue_quick_invoice(uuid, text), public.send_quick_invoice(uuid, text),
  public.void_quick_invoice(uuid, text), public.record_quick_payment(uuid, int, text, text, date), public.void_quick_payment(uuid, text)
from public, anon;
grant execute on function
  public.save_quick_invoice(uuid, jsonb), public.issue_quick_invoice(uuid, text), public.send_quick_invoice(uuid, text),
  public.void_quick_invoice(uuid, text), public.record_quick_payment(uuid, int, text, text, date), public.void_quick_payment(uuid, text)
to authenticated, service_role;
