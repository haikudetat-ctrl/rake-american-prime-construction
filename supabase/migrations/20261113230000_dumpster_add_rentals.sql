-- Dumpsters: adding rentals quickly, several at once, and after the fact, and
-- a price list of extra charges (Nov 13). The subcontracting side got the same
-- treatment in the sub_add_jobs migration.
--
-- A rental that nobody recorded can't go through the normal steps afterwards:
-- the drop and the pickup each need a driver's photo taken at the time, and
-- the dump needs the ticket entered at the scale. add_rentals records it as it
-- actually stands, in one transaction:
--   scheduled  booked for today or later, exactly as create_rental books it;
--   on_site    the can went out and is still there: the can leaves the yard,
--              the drop is recorded, and the invoice opens with the delivery
--              line, as complete_stop does on a drop;
--   done       dropped, picked up and dumped: the drop, pickup and dump are
--              recorded on their days, the extra days and the disposal are
--              billed as complete_stop and record_scale_ticket bill them, and
--              the invoice is final, so it goes on the customer's next
--              statement.
-- Steps recorded this way are completed by the office person, have no photos,
-- and the rental's history says "rental recorded", so a rental entered after
-- the fact is never mistaken for one a driver ran. It is billed from the price
-- book in force on its drop day, as it would have been if booked on time.
--
-- The same guards as the subcontracting list: one bad rental refuses the whole
-- list and the error names it; the same customer, address and drop day twice
-- is refused; a billed rental carries the invoice total the office was shown
-- and is refused if the database works out a different one (the price book
-- changed while the list was typed).
--
-- The price list: charges the owner sets (a mattress, tires, a dry run, a
-- relocation). Picked items become invoice lines of their own kind, "charge",
-- priced at the moment they're added: changing the list never rewrites an
-- invoice. Credits stay adjustments. QuickBooks gets its own item mapping for
-- them; until an owner picks one, those invoices report the missing mapping
-- like any other kind.

-- Price list ----------------------------------------------------------------------

create table public.dumpster_price_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  description text not null check (length(trim(description)) > 0),
  unit text not null default 'each' check (unit in ('each', 'day', 'ton', 'hour', 'trip')),
  unit_cents int not null check (unit_cents > 0 and unit_cents <= 10000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, description)
);
create trigger dumpster_price_items_touch before update on public.dumpster_price_items
  for each row execute function app.touch_updated_at();
create trigger dumpster_price_items_audit after insert or update on public.dumpster_price_items
  for each row execute function app.audit();

alter table public.dumpster_price_items enable row level security;
revoke all on public.dumpster_price_items from anon, authenticated;
grant select, insert, update on public.dumpster_price_items to authenticated;
grant all on public.dumpster_price_items to service_role;
-- Office picks from it; prices are the owner's, like the price book.
create policy dumpster_price_items_staff_read on public.dumpster_price_items for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy dumpster_price_items_owner_insert on public.dumpster_price_items for insert to authenticated
  with check (app.is_owner() and company_id = app.current_company_id());
create policy dumpster_price_items_owner_update on public.dumpster_price_items for update to authenticated
  using (app.is_owner() and company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

-- Charge lines ------------------------------------------------------------------------

alter table public.invoice_lines drop constraint invoice_lines_kind_check;
alter table public.invoice_lines add constraint invoice_lines_kind_check
  check (kind in ('delivery', 'extended_days', 'tonnage', 'charge', 'adjustment'));
-- One delivery, extra-days and disposal line per invoice; any number of charges.
drop index public.invoice_lines_one_per_kind;
create unique index invoice_lines_one_per_kind on public.invoice_lines(invoice_id, kind)
  where kind not in ('charge', 'adjustment');

alter table public.qbo_settings add column item_charge text;

-- Price-list items onto an invoice the caller has already checked and locked:
-- [{"item_id": "…", "qty": 2}, …]. Each item once; quantities to the hundredth.
create function app.add_charge_lines(p_invoice public.invoices, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb;
  v_item public.dumpster_price_items;
  v_qty numeric;
  v_count int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pick at least one item';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'pick up to 50 items at a time'; end if;
  if (select count(distinct e.value ->> 'item_id') from jsonb_array_elements(p_items) as e) < jsonb_array_length(p_items) then
    raise exception 'an item is picked twice; put the total in one line';
  end if;
  for v_entry in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_entry) <> 'object' or coalesce(jsonb_typeof(v_entry -> 'qty'), '') <> 'number' then
      raise exception 'enter how many for each item';
    end if;
    select * into v_item from public.dumpster_price_items
    where id = (v_entry ->> 'item_id')::uuid and company_id = p_invoice.company_id and is_active;
    if v_item.id is null then raise exception 'pick an item from the price list' using errcode = 'P0002'; end if;
    v_qty := round((v_entry ->> 'qty')::numeric, 2);
    if v_qty <= 0 or v_qty > 9999 then raise exception 'enter how many %', v_item.description; end if;
    insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
    values (
      p_invoice.company_id, p_invoice.id, 'charge',
      case when v_qty = 1 then v_item.description
           else format('%s: %s at %s', v_item.description, trim_scale(v_qty), to_char(v_item.unit_cents / 100.0, 'FM$999,999,990.00')) end,
      v_qty, v_item.unit_cents, round(v_qty * v_item.unit_cents)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Office: price-list items onto a rental's invoice before it's billed.
create function public.add_invoice_charges(p_invoice_id uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company;
  if v_invoice.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  v_invoice := app.lock_open_invoice(v_invoice.rental_id);
  if v_invoice.status = 'void' then raise exception 'invoice is void'; end if;
  return app.add_charge_lines(v_invoice, p_items);
end;
$$;

-- A charge comes off the same way an adjustment does, before billing.
create or replace function public.remove_invoice_adjustment(p_line_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_line public.invoice_lines;
  v_invoice public.invoices;
begin
  select * into v_line from public.invoice_lines where id = p_line_id and company_id = v_company;
  if v_line.id is null or v_line.kind not in ('adjustment', 'charge') then raise exception 'adjustment not found'; end if;
  select * into v_invoice from public.invoices where id = v_line.invoice_id;
  perform app.lock_open_invoice(v_invoice.rental_id);
  delete from public.invoice_lines where id = v_line.id;
  if (select total_cents from public.invoices where id = v_invoice.id) < 0 then
    raise exception 'an invoice cannot go below zero';
  end if;
end;
$$;

-- Rentals -------------------------------------------------------------------------------

-- "12 Oak St." and "12 oak st" are the same address.
create function app.address_key(p_address text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p_address, '')), '[^a-z0-9]+', '', 'g')
$$;

-- Midday on a day in the company's time zone: when a step recorded after the
-- fact happened, as far as anyone knows. It keeps the step on its own day for
-- the extra-days count and the weekly numbers.
create function app.company_midday(p_company_id uuid, p_day date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (p_day + time '12:00') at time zone c.timezone from public.companies c where c.id = p_company_id
$$;

-- The price book in force on a day: the newest published on or before it (the
-- first one, for a day before any). A rental entered late is billed what it
-- would have been billed had it been booked on time, not today's prices.
create function app.price_book_on(p_company_id uuid, p_day date) returns public.price_books
language plpgsql stable security definer set search_path = '' as $$
declare
  v_book public.price_books;
begin
  select * into v_book from public.price_books
  where company_id = p_company_id and app.local_date(p_company_id, created_at) <= p_day
  order by version desc limit 1;
  if v_book.id is null then
    select * into v_book from public.price_books where company_id = p_company_id order by version limit 1;
  end if;
  if v_book.id is null then raise exception 'no active price book'; end if;
  return v_book;
end;
$$;

-- A list of rentals, each:
--   {"customer_id", "site_id" | "address" (+ "area", "lat", "lng", "place_id"),
--    "drop_date", "state": "scheduled" | "on_site" | "done", "notes",
--    "can_id", "picked_up_on", "tons", "dump_fee_cents", "ticket_number",
--    "landfill_id", "items": [{"item_id", "qty"}], "expected_total_cents"}
-- Returns [{"rental_id", "invoice_number"}], the number null for a booking.
create function public.add_rentals(p_rentals jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_today date := app.company_today(v_company);
  v_book public.price_books;
  v_entry jsonb;
  v_n int := 0;
  v_customer uuid;
  v_site uuid;
  v_address text;
  v_state text;
  v_drop date;
  v_pickup date;
  v_can public.cans;
  v_tons numeric;
  v_fee int;
  v_ticket text;
  v_landfill uuid;
  v_key text;
  v_seen text[] := '{}';
  v_rental uuid;
  v_invoice public.invoices;
  v_extra int;
  v_total int;
  v_out jsonb := '[]'::jsonb;
  v_msg text;
  v_hint text;
  v_state_code text;
begin
  if p_rentals is null or jsonb_typeof(p_rentals) <> 'array' or jsonb_array_length(p_rentals) = 0 then
    raise exception 'add at least one rental';
  end if;
  if jsonb_array_length(p_rentals) > 50 then raise exception 'add up to 50 rentals at a time'; end if;

  for v_entry in select e.value from jsonb_array_elements(p_rentals) as e loop
    v_n := v_n + 1;
    begin
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'it isn''t a rental'; end if;
      v_customer := nullif(v_entry ->> 'customer_id', '')::uuid;
      v_site := nullif(v_entry ->> 'site_id', '')::uuid;
      v_state := v_entry ->> 'state';
      v_drop := nullif(v_entry ->> 'drop_date', '')::date;
      if not exists (select 1 from public.customers where id = v_customer and company_id = v_company) then
        raise exception 'pick the customer' using errcode = 'P0002';
      end if;
      if v_drop is null then raise exception 'pick the drop day'; end if;
      if v_state is null or v_state not in ('scheduled', 'on_site', 'done') then raise exception 'say whether it''s been dropped'; end if;

      -- The address: one of the customer's, or a new one (reused if they already have it).
      if v_site is not null then
        select address into v_address from public.sites where id = v_site and customer_id = v_customer and company_id = v_company;
        if v_address is null then raise exception 'that address isn''t one of this customer''s' using errcode = 'P0002'; end if;
      else
        v_address := trim(coalesce(v_entry ->> 'address', ''));
        if v_address = '' then raise exception 'enter the address'; end if;
        select id into v_site from public.sites
        where customer_id = v_customer and company_id = v_company and app.address_key(address) = app.address_key(v_address)
        order by created_at limit 1;
      end if;

      v_key := concat_ws('|', v_customer, v_drop, app.address_key(v_address));
      if v_key = any(v_seen) then
        raise exception '% on % is in this list twice', v_address, to_char(v_drop, 'Mon FMDD');
      end if;
      v_seen := v_seen || v_key;
      if exists (
        select 1 from public.rentals r join public.sites s on s.id = r.site_id
        where r.company_id = v_company and r.customer_id = v_customer and r.requested_drop_date = v_drop
          and r.status <> 'cancelled' and app.address_key(s.address) = app.address_key(v_address)
      ) then
        raise exception '% on % is already in Rake for this customer', v_address, to_char(v_drop, 'Mon FMDD');
      end if;

      if v_site is null then
        insert into public.sites (company_id, customer_id, address, area, lat, lng, place_id)
        values (v_company, v_customer, v_address, nullif(trim(coalesce(v_entry ->> 'area', '')), ''),
                (v_entry ->> 'lat')::double precision, (v_entry ->> 'lng')::double precision,
                nullif(v_entry ->> 'place_id', ''))
        returning id into v_site;
      end if;

      if v_state = 'scheduled' then
        if v_drop < v_today then
          raise exception 'a drop before today already happened: say which can went out, or move it to today or later';
        end if;
        if jsonb_typeof(v_entry -> 'items') = 'array' and jsonb_array_length(v_entry -> 'items') > 0 then
          raise exception 'line items go on once the can is dropped';
        end if;
        v_rental := app.create_rental_internal(v_company, v_customer, v_site, v_drop, null, null, null,
                                               nullif(trim(coalesce(v_entry ->> 'notes', '')), ''));
        v_out := v_out || jsonb_build_object('rental_id', v_rental, 'invoice_number', null);
        continue;
      end if;

      -- Dropped: on the job now, or done.
      if v_drop > v_today then raise exception 'it''s dated after today, so it can''t have been dropped yet'; end if;
      v_book := app.price_book_on(v_company, v_drop);
      if coalesce(jsonb_typeof(v_entry -> 'expected_total_cents'), '') <> 'number' then
        raise exception 'review its total before adding it';
      end if;
      v_can := null;
      if nullif(v_entry ->> 'can_id', '') is not null then
        select * into v_can from public.cans where id = (v_entry ->> 'can_id')::uuid and company_id = v_company;
        if v_can.id is null then raise exception 'pick the can' using errcode = 'P0002'; end if;
      end if;
      v_pickup := null;
      if v_state = 'on_site' then
        if v_can.id is null then raise exception 'say which can is out there'; end if;
        update public.cans set status = 'on_site' where id = v_can.id and status = 'available';
        if not found then raise exception 'can % isn''t in the yard in Rake; check where it is', v_can.label; end if;
      else
        v_pickup := nullif(v_entry ->> 'picked_up_on', '')::date;
        if v_pickup is null then raise exception 'enter the day it was picked up'; end if;
        if v_pickup < v_drop then raise exception 'the pickup is before the drop'; end if;
        if v_pickup > v_today then raise exception 'the pickup is after today'; end if;
        v_tons := nullif(v_entry ->> 'tons', '')::numeric;
        v_fee := nullif(v_entry ->> 'dump_fee_cents', '')::int;
        if v_tons is null or v_tons < 0 or v_tons > 99 then raise exception 'enter the tons from the scale ticket'; end if;
        if v_fee is null or v_fee < 0 then raise exception 'enter the dump fee from the scale ticket'; end if;
        v_ticket := nullif(trim(coalesce(v_entry ->> 'ticket_number', '')), '');
        v_landfill := nullif(v_entry ->> 'landfill_id', '')::uuid;
        if v_landfill is not null and not exists (select 1 from public.landfills where id = v_landfill and company_id = v_company) then
          raise exception 'landfill not found' using errcode = 'P0002';
        end if;
      end if;

      insert into public.rentals (
        company_id, brand_id, customer_id, site_id, price_book_id, can_id, size_yards, status,
        requested_drop_date, dropped_at, picked_up_at, dumped_at, notes, created_by
      ) values (
        v_company, app.dumpster_brand(v_company), v_customer, v_site, v_book.id, v_can.id, v_can.size_yards,
        case v_state when 'on_site' then 'on_site' else 'closed' end,
        v_drop, app.company_midday(v_company, v_drop),
        case when v_pickup is not null then app.company_midday(v_company, v_pickup) end,
        case when v_pickup is not null then app.company_midday(v_company, v_pickup) end,
        nullif(trim(coalesce(v_entry ->> 'notes', '')), ''), auth.uid()
      ) returning id into v_rental;

      insert into public.stops (company_id, rental_id, kind, scheduled_date, status, completed_at, completed_by)
      values (v_company, v_rental, 'drop', v_drop, 'done', now(), auth.uid());

      insert into public.invoices (company_id, rental_id, customer_id, number)
      values (v_company, v_rental, v_customer, app.next_number(v_company, 'invoice'))
      returning * into v_invoice;
      insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
      values (v_company, v_invoice.id, 'delivery', 'Dumpster delivery and pickup', 1, v_book.delivery_fee_cents, v_book.delivery_fee_cents);

      if v_state = 'done' then
        insert into public.stops (company_id, rental_id, kind, scheduled_date, status, completed_at, completed_by, sequence)
        values (v_company, v_rental, 'pickup', v_pickup, 'done', now(), auth.uid(), 0),
               (v_company, v_rental, 'dump', v_pickup, 'done', now(), auth.uid(), 1);
        -- Extra days the way a pickup counts them: calendar days on the job past the included ones.
        v_extra := (v_pickup - v_drop) - v_book.extended_after_days;
        if v_extra > 0 and v_book.extended_fee_cents_per_day > 0 then
          insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
          values (v_company, v_invoice.id, 'extended_days',
                  format('Extended rental: %s days past %s', v_extra, v_book.extended_after_days),
                  v_extra, v_book.extended_fee_cents_per_day, v_extra * v_book.extended_fee_cents_per_day);
        end if;
        insert into public.scale_tickets (company_id, rental_id, landfill_id, ticket_number, tons, fee_cents, entered_by)
        values (v_company, v_rental, v_landfill, v_ticket, v_tons, v_fee, auth.uid());
        insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
        values (v_company, v_invoice.id, 'tonnage',
                format('Disposal: %s tons%s', v_tons, coalesce(', ticket ' || v_ticket, '')), v_tons, null, v_fee);
      end if;

      if jsonb_typeof(v_entry -> 'items') = 'array' and jsonb_array_length(v_entry -> 'items') > 0 then
        perform app.add_charge_lines(v_invoice, v_entry -> 'items');
      end if;
      if v_state = 'done' then
        update public.invoices set status = 'final', finalized_at = now() where id = v_invoice.id;
      end if;

      select total_cents into v_total from public.invoices where id = v_invoice.id;
      if v_total is distinct from (v_entry ->> 'expected_total_cents')::int then
        raise exception 'its total changed while you were adding it (prices now make it %)',
          to_char(v_total / 100.0, 'FM$999,999,990.00') using hint = 'stale_review';
      end if;

      perform app.emit(v_company, 'rental', v_rental, 'rental_recorded',
        jsonb_build_object('state', v_state, 'drop_date', v_drop, 'picked_up_on', v_pickup, 'invoice_number', v_invoice.number));
      v_out := v_out || jsonb_build_object('rental_id', v_rental, 'invoice_number', v_invoice.number);
    exception when others then
      -- Name the rental, keep the code and hint. Raising here undoes the whole list.
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_state_code = returned_sqlstate;
      raise exception 'Rental %: %', v_n, v_msg using errcode = v_state_code, hint = coalesce(v_hint, ''), detail = 'rental:' || v_n;
    end;
  end loop;
  return v_out;
end;
$$;

-- Grants ----------------------------------------------------------------------------------

revoke execute on function
  app.add_charge_lines(public.invoices, jsonb), app.address_key(text), app.company_midday(uuid, date),
  app.price_book_on(uuid, date)
from public, anon, authenticated;
grant execute on function
  app.add_charge_lines(public.invoices, jsonb), app.address_key(text), app.company_midday(uuid, date),
  app.price_book_on(uuid, date)
to service_role;

revoke execute on function public.add_invoice_charges(uuid, jsonb), public.add_rentals(jsonb) from public, anon;
grant execute on function public.add_invoice_charges(uuid, jsonb), public.add_rentals(jsonb) to authenticated, service_role;
