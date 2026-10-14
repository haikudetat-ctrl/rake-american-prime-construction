-- Phase 1: dumpster operations.
--
-- Read paths: staff (owner/office) read everything in their company through
-- RLS. Drivers read cans, yards and landfills, and get their run through
-- driver_run(), which returns only the columns a driver needs. Drivers have
-- no policy on any table holding prices, invoices, customers or payments, so
-- "drivers cannot see money" holds even if the app has a bug.
--
-- Write paths: master data (customers, sites, cans, yards, landfills) is
-- edited directly by staff under RLS. Everything that moves money or a can
-- (rentals, stops, tickets, invoices, statements, payments) is written only
-- by the SECURITY DEFINER functions at the bottom, so each workflow step and
-- its billing side effect commit together or not at all.

-- Helpers -----------------------------------------------------------------------

create function app.company_today(p_company_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone c.timezone)::date from public.companies c where c.id = p_company_id
$$;

create function app.local_date(p_company_id uuid, p_at timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select (p_at at time zone c.timezone)::date from public.companies c where c.id = p_company_id
$$;

-- Master data -------------------------------------------------------------------

create table public.yards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.landfills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  label text not null,
  size_yards int not null check (size_yards > 0),
  home_yard_id uuid references public.yards(id),
  status text not null default 'available'
    check (status in ('available', 'on_site', 'in_transit', 'out_of_service')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, label)
);
create trigger cans_touch before update on public.cans for each row execute function app.touch_updated_at();

-- Price books are versioned and never edited: a rental stores the version it
-- was booked under, so a rate change never rewrites an existing invoice.
create table public.price_books (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  version int not null,
  delivery_fee_cents int not null check (delivery_fee_cents >= 0),
  extended_after_days int not null check (extended_after_days >= 0),
  extended_fee_cents_per_day int not null check (extended_fee_cents_per_day >= 0),
  -- True while the numbers are placeholders awaiting the owner's confirmation;
  -- the office UI shows a banner until an owner publishes a confirmed version.
  needs_confirmation boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, version)
);
create unique index price_books_one_active on public.price_books(company_id) where is_active;

create function app.price_books_immutable() returns trigger
language plpgsql as $$
begin
  if (new.delivery_fee_cents, new.extended_after_days, new.extended_fee_cents_per_day,
      new.version, new.company_id, new.needs_confirmation)
     is distinct from
     (old.delivery_fee_cents, old.extended_after_days, old.extended_fee_cents_per_day,
      old.version, old.company_id, old.needs_confirmation) then
    raise exception 'price books are immutable; publish a new version';
  end if;
  return new;
end;
$$;
create trigger price_books_immutable before update on public.price_books
  for each row execute function app.price_books_immutable();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  billing_email text,
  phone text,
  payment_terms_days int not null default 15 check (payment_terms_days between 0 and 120),
  notes text,
  is_active boolean not null default true,
  qbo_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customers_touch before update on public.customers for each row execute function app.touch_updated_at();

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  address text not null,
  -- Town, used to group a driver's run by area.
  area text,
  lat double precision,
  lng double precision,
  place_id text,
  notes text,
  created_at timestamptz not null default now()
);

-- The link the owner texts to customers. One per brand to start; per-customer
-- links can be added later without schema change.
create table public.request_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  brand_id uuid not null references public.brands(id),
  slug text not null unique check (slug ~ '^[a-z0-9-]{4,64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Workflow ----------------------------------------------------------------------

create table public.rental_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  request_link_id uuid not null references public.request_links(id),
  contact_name text not null,
  company_name text,
  phone text not null,
  email text,
  address text not null,
  area text,
  lat double precision,
  lng double precision,
  place_id text,
  requested_date date not null,
  size_yards int,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  customer_id uuid references public.customers(id),
  rental_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  decline_reason text,
  submitter_hash text,
  created_at timestamptz not null default now()
);
create index rental_requests_pending_idx on public.rental_requests(company_id, created_at) where status = 'pending';

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  brand_id uuid not null references public.brands(id),
  customer_id uuid not null references public.customers(id),
  site_id uuid not null references public.sites(id),
  price_book_id uuid not null references public.price_books(id),
  request_id uuid references public.rental_requests(id),
  can_id uuid references public.cans(id),
  size_yards int,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'on_site', 'pickup_requested', 'picked_up', 'closed', 'cancelled')),
  requested_drop_date date not null,
  dropped_at timestamptz,
  picked_up_at timestamptz,
  dumped_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rentals_status_idx on public.rentals(company_id, status);
create unique index rentals_one_per_can on public.rentals(can_id)
  where status in ('on_site', 'pickup_requested', 'picked_up');
create trigger rentals_touch before update on public.rentals for each row execute function app.touch_updated_at();
alter table public.rental_requests
  add constraint rental_requests_rental_fk foreign key (rental_id) references public.rentals(id);

create table public.stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rental_id uuid not null references public.rentals(id),
  kind text not null check (kind in ('drop', 'pickup', 'dump')),
  scheduled_date date not null,
  driver_id uuid references auth.users(id),
  sequence int not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now()
);
create index stops_run_idx on public.stops(company_id, scheduled_date, driver_id);
create unique index stops_one_open_per_kind on public.stops(rental_id, kind) where status = 'scheduled';

create table public.scale_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rental_id uuid not null unique references public.rentals(id),
  landfill_id uuid references public.landfills(id),
  ticket_number text,
  tons numeric(8, 2) not null check (tons >= 0),
  fee_cents int not null check (fee_cents >= 0),
  photo_path text,
  entered_by uuid,
  entered_at timestamptz not null default now()
);

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  number int not null,
  issued_on date not null,
  due_on date not null,
  total_cents int not null default 0,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rental_id uuid not null unique references public.rentals(id),
  customer_id uuid not null references public.customers(id),
  number int not null,
  status text not null default 'draft'
    check (status in ('draft', 'final', 'on_statement', 'paid', 'void')),
  total_cents int not null default 0,
  finalized_at timestamptz,
  statement_id uuid references public.statements(id),
  qbo_invoice_id text,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);
create index invoices_unbilled_idx on public.invoices(company_id, customer_id) where status = 'final';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  kind text not null check (kind in ('delivery', 'extended_days', 'tonnage', 'adjustment')),
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_cents int,
  amount_cents int not null,
  created_at timestamptz not null default now()
);
create unique index invoice_lines_one_per_kind on public.invoice_lines(invoice_id, kind) where kind <> 'adjustment';

create function app.invoice_total_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  update public.invoices i
  set total_cents = coalesce((select sum(amount_cents) from public.invoice_lines where invoice_id = v_invoice), 0)
  where i.id = v_invoice;
  return null;
end;
$$;
create trigger invoice_lines_total after insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_total_sync();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id),
  statement_id uuid not null references public.statements(id),
  amount_cents int not null check (amount_cents > 0),
  method text not null check (method in ('check', 'ach', 'cash', 'qbo', 'other')),
  reference text,
  received_on date not null,
  recorded_by uuid,
  created_at timestamptz not null default now()
);

-- Audit on everything that carries money or custody of a can.
create trigger customers_audit after insert or update or delete on public.customers for each row execute function app.audit();
create trigger cans_audit after insert or update or delete on public.cans for each row execute function app.audit();
create trigger price_books_audit after insert or update on public.price_books for each row execute function app.audit();
create trigger rentals_audit after insert or update on public.rentals for each row execute function app.audit();
create trigger invoices_audit after insert or update on public.invoices for each row execute function app.audit();
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines for each row execute function app.audit();
create trigger statements_audit after insert or update on public.statements for each row execute function app.audit();
create trigger payments_audit after insert or update or delete on public.payments for each row execute function app.audit();

-- RLS ---------------------------------------------------------------------------

alter table public.yards enable row level security;
alter table public.landfills enable row level security;
alter table public.cans enable row level security;
alter table public.price_books enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.sites enable row level security;
alter table public.request_links enable row level security;
alter table public.rental_requests enable row level security;
alter table public.rentals enable row level security;
alter table public.stops enable row level security;
alter table public.scale_tickets enable row level security;
alter table public.statements enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;

grant select on
  public.yards, public.landfills, public.cans, public.price_books, public.customers,
  public.customer_contacts, public.sites, public.request_links, public.rental_requests,
  public.rentals, public.stops, public.scale_tickets, public.statements, public.invoices,
  public.invoice_lines, public.payments
  to authenticated;
grant insert, update on
  public.yards, public.landfills, public.cans, public.customers, public.customer_contacts,
  public.sites, public.request_links
  to authenticated;
grant delete on public.customer_contacts to authenticated;
grant all on all tables in schema public to service_role;

-- Operational reference data every member may read (drivers pick a can and a landfill).
create policy yards_member_read on public.yards for select to authenticated
  using (company_id = app.current_company_id());
create policy landfills_member_read on public.landfills for select to authenticated
  using (company_id = app.current_company_id());
create policy cans_member_read on public.cans for select to authenticated
  using (company_id = app.current_company_id() and app.member_role() in ('owner', 'office', 'driver'));

create policy yards_staff_write on public.yards for all to authenticated
  using (app.is_staff() and company_id = app.current_company_id())
  with check (app.is_staff() and company_id = app.current_company_id());
create policy landfills_staff_write on public.landfills for all to authenticated
  using (app.is_staff() and company_id = app.current_company_id())
  with check (app.is_staff() and company_id = app.current_company_id());
create policy cans_staff_write on public.cans for all to authenticated
  using (app.is_staff() and company_id = app.current_company_id())
  with check (app.is_staff() and company_id = app.current_company_id());

-- Staff-only tables: one read policy each, plus writes for master data.
do $$
declare
  t text;
begin
  foreach t in array array[
    'price_books', 'customers', 'customer_contacts', 'sites', 'request_links',
    'rental_requests', 'rentals', 'scale_tickets', 'statements', 'invoices',
    'invoice_lines', 'payments'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_staff() and company_id = app.current_company_id())',
      t || '_staff_read', t
    );
  end loop;
  foreach t in array array['customers', 'customer_contacts', 'sites', 'request_links'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.is_staff() and company_id = app.current_company_id())',
      t || '_staff_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.is_staff() and company_id = app.current_company_id()) with check (company_id = app.current_company_id())',
      t || '_staff_update', t
    );
  end loop;
end;
$$;
create policy customer_contacts_staff_delete on public.customer_contacts for delete to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Stops: staff see all; a driver sees only their own (no prices on this table).
create policy stops_read on public.stops for select to authenticated
  using (
    company_id = app.current_company_id()
    and (app.is_staff() or (app.member_role() = 'driver' and driver_id = auth.uid()))
  );

-- Live board view (security_invoker, so the caller's RLS applies) ------------------

create view public.rentals_out with (security_invoker = true) as
select
  r.id as rental_id,
  r.company_id,
  r.status,
  r.dropped_at,
  r.customer_id,
  c.name as customer_name,
  s.address,
  s.area,
  r.can_id,
  k.label as can_label,
  k.size_yards,
  pb.extended_after_days,
  app.company_today(r.company_id) - app.local_date(r.company_id, r.dropped_at) as days_out,
  app.company_today(r.company_id) - app.local_date(r.company_id, r.dropped_at) > pb.extended_after_days as is_extended
from public.rentals r
join public.customers c on c.id = r.customer_id
join public.sites s on s.id = r.site_id
join public.price_books pb on pb.id = r.price_book_id
left join public.cans k on k.id = r.can_id
where r.status in ('on_site', 'pickup_requested');
grant select on public.rentals_out to authenticated;

-- Workflow functions ------------------------------------------------------------

create function app.dumpster_brand(p_company_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.brands where company_id = p_company_id and kind = 'dumpster'
$$;

create function app.active_price_book(p_company_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.price_books where company_id = p_company_id and is_active;
  if v_id is null then
    raise exception 'no active price book';
  end if;
  return v_id;
end;
$$;

-- Public intake. Called only by the server route with the service role, after
-- it has validated the payload and the bot checks.
create function public.submit_rental_request(
  p_slug text,
  p_contact_name text,
  p_company_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_place_id text,
  p_requested_date date,
  p_size_yards int,
  p_notes text,
  p_submitter_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.request_links;
  v_id uuid;
  v_recent int;
  v_staff record;
begin
  select * into v_link from public.request_links where slug = p_slug and is_active;
  if v_link.id is null then
    raise exception 'unknown request link' using errcode = 'P0002';
  end if;

  if p_requested_date < app.company_today(v_link.company_id) then
    raise exception 'requested date is in the past' using errcode = '22023';
  end if;

  select count(*) into v_recent from public.rental_requests
  where submitter_hash = p_submitter_hash and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.rental_requests (
    company_id, request_link_id, contact_name, company_name, phone, email, address, area,
    lat, lng, place_id, requested_date, size_yards, notes, submitter_hash
  ) values (
    v_link.company_id, v_link.id, p_contact_name, nullif(p_company_name, ''), p_phone,
    nullif(p_email, ''), p_address, nullif(p_area, ''), p_lat, p_lng, nullif(p_place_id, ''),
    p_requested_date, p_size_yards, nullif(p_notes, ''), p_submitter_hash
  ) returning id into v_id;

  perform app.emit(v_link.company_id, 'rental_request', v_id, 'request_submitted');

  for v_staff in
    select p.phone, p.locale from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.company_id = v_link.company_id and m.is_active
      and m.role in ('owner', 'office') and p.phone is not null
  loop
    perform app.enqueue(
      v_link.company_id, 'sms', 'request_received',
      jsonb_build_object(
        'to', v_staff.phone, 'locale', v_staff.locale, 'request_id', v_id,
        'name', coalesce(nullif(p_company_name, ''), p_contact_name),
        'date', p_requested_date, 'address', p_address
      ),
      'request:' || v_id || ':notify:' || v_staff.phone
    );
  end loop;

  return v_id;
end;
$$;

create function app.create_rental_internal(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_id uuid,
  p_drop_date date,
  p_driver_id uuid,
  p_size_yards int,
  p_request_id uuid,
  p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_rental uuid;
begin
  if p_driver_id is not null and not exists (
    select 1 from public.memberships
    where user_id = p_driver_id and company_id = p_company_id and is_active and role in ('driver', 'owner', 'office')
  ) then
    raise exception 'driver is not on this team';
  end if;

  insert into public.rentals (
    company_id, brand_id, customer_id, site_id, price_book_id, request_id,
    size_yards, requested_drop_date, notes, created_by
  ) values (
    p_company_id, app.dumpster_brand(p_company_id), p_customer_id, p_site_id,
    app.active_price_book(p_company_id), p_request_id, p_size_yards, p_drop_date,
    p_notes, auth.uid()
  ) returning id into v_rental;

  insert into public.stops (company_id, rental_id, kind, scheduled_date, driver_id)
  values (p_company_id, v_rental, 'drop', p_drop_date, p_driver_id);

  perform app.emit(p_company_id, 'rental', v_rental, 'rental_scheduled',
    jsonb_build_object('drop_date', p_drop_date));
  return v_rental;
end;
$$;

-- Approve a request. p_customer_id picks an existing customer; null creates
-- one from the request.
create function public.approve_request(
  p_request_id uuid,
  p_customer_id uuid,
  p_drop_date date,
  p_driver_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_req public.rental_requests;
  v_customer uuid := p_customer_id;
  v_site uuid;
  v_rental uuid;
begin
  select * into v_req from public.rental_requests
  where id = p_request_id and company_id = v_company for update;
  if v_req.id is null then raise exception 'request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'request already %', v_req.status; end if;

  if v_customer is null then
    insert into public.customers (company_id, name, billing_email, phone)
    values (v_company, coalesce(v_req.company_name, v_req.contact_name), v_req.email, v_req.phone)
    returning id into v_customer;
  elsif not exists (select 1 from public.customers where id = v_customer and company_id = v_company) then
    raise exception 'customer not found';
  end if;

  if not exists (
    select 1 from public.customer_contacts where customer_id = v_customer and phone = v_req.phone
  ) then
    insert into public.customer_contacts (company_id, customer_id, name, phone, email)
    values (v_company, v_customer, v_req.contact_name, v_req.phone, v_req.email);
  end if;

  insert into public.sites (company_id, customer_id, address, area, lat, lng, place_id)
  values (v_company, v_customer, v_req.address, v_req.area, v_req.lat, v_req.lng, v_req.place_id)
  returning id into v_site;

  v_rental := app.create_rental_internal(
    v_company, v_customer, v_site, coalesce(p_drop_date, v_req.requested_date),
    p_driver_id, v_req.size_yards, v_req.id, v_req.notes
  );

  update public.rental_requests
  set status = 'approved', customer_id = v_customer, rental_id = v_rental,
      decided_by = auth.uid(), decided_at = now()
  where id = v_req.id;

  perform app.enqueue(
    v_company, 'sms', 'request_approved',
    jsonb_build_object('to', v_req.phone, 'date', coalesce(p_drop_date, v_req.requested_date),
                       'address', v_req.address, 'rental_id', v_rental),
    'request:' || v_req.id || ':approved'
  );
  return v_rental;
end;
$$;

create function public.decline_request(p_request_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  update public.rental_requests
  set status = 'declined', decline_reason = p_reason, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id and company_id = v_company and status = 'pending';
  if not found then raise exception 'request not found or already decided'; end if;
end;
$$;

-- Book a rental directly (phone and text orders from known customers).
create function public.create_rental(
  p_customer_id uuid,
  p_site_id uuid,
  p_drop_date date,
  p_driver_id uuid default null,
  p_size_yards int default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  if not exists (
    select 1 from public.sites where id = p_site_id and customer_id = p_customer_id and company_id = v_company
  ) then
    raise exception 'site not found for customer';
  end if;
  return app.create_rental_internal(v_company, p_customer_id, p_site_id, p_drop_date,
                                    p_driver_id, p_size_yards, null, p_notes);
end;
$$;

create function public.request_pickup(p_rental_id uuid, p_date date, p_driver_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_stop uuid;
begin
  update public.rentals set status = 'pickup_requested'
  where id = p_rental_id and company_id = v_company and status = 'on_site';
  if not found then raise exception 'rental is not on site'; end if;

  insert into public.stops (company_id, rental_id, kind, scheduled_date, driver_id)
  values (v_company, p_rental_id, 'pickup', p_date, p_driver_id)
  returning id into v_stop;
  perform app.emit(v_company, 'rental', p_rental_id, 'pickup_requested', jsonb_build_object('date', p_date));
  return v_stop;
end;
$$;

create function public.assign_stop(p_stop_id uuid, p_driver_id uuid, p_date date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  if p_driver_id is not null and not exists (
    select 1 from public.memberships
    where user_id = p_driver_id and company_id = v_company and is_active and role in ('driver', 'owner', 'office')
  ) then
    raise exception 'driver is not on this team';
  end if;
  update public.stops set driver_id = p_driver_id, scheduled_date = p_date
  where id = p_stop_id and company_id = v_company and status = 'scheduled';
  if not found then raise exception 'stop not found or already done'; end if;
end;
$$;

-- Saves a run order computed by the office (lib/dispatch).
create function public.sequence_stops(p_stop_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  update public.stops s set sequence = o.ord
  from unnest(p_stop_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.company_id = v_company;
end;
$$;

-- Locks a stop the caller may work: staff, or the driver it is assigned to.
create function app.lock_workable_stop(p_stop_id uuid) returns public.stops
language plpgsql security definer set search_path = '' as $$
declare
  v_stop public.stops;
begin
  select * into v_stop from public.stops
  where id = p_stop_id and company_id = app.current_company_id() for update;
  if v_stop.id is null then raise exception 'stop not found'; end if;
  if not (app.is_staff() or (app.member_role() = 'driver' and v_stop.driver_id = auth.uid())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_stop.status <> 'scheduled' then raise exception 'stop already %', v_stop.status; end if;
  return v_stop;
end;
$$;

-- Drop or pickup. The dump stop is completed by record_scale_ticket.
create function public.complete_stop(p_stop_id uuid, p_can_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_stop public.stops := app.lock_workable_stop(p_stop_id);
  v_rental public.rentals;
  v_pb public.price_books;
  v_invoice uuid;
  v_days int;
  v_extra int;
begin
  select * into v_rental from public.rentals where id = v_stop.rental_id for update;
  select * into v_pb from public.price_books where id = v_rental.price_book_id;

  if v_stop.kind = 'drop' then
    if v_rental.status <> 'scheduled' then raise exception 'rental is %', v_rental.status; end if;
    if p_can_id is null then raise exception 'choose the can that was dropped'; end if;
    update public.cans set status = 'on_site'
    where id = p_can_id and company_id = v_stop.company_id and status = 'available';
    if not found then raise exception 'can is not available'; end if;

    update public.rentals set status = 'on_site', can_id = p_can_id, dropped_at = now()
    where id = v_rental.id;

    insert into public.invoices (company_id, rental_id, customer_id, number)
    values (v_stop.company_id, v_rental.id, v_rental.customer_id,
            app.next_number(v_stop.company_id, 'invoice'))
    returning id into v_invoice;
    insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
    values (v_stop.company_id, v_invoice, 'delivery', 'Dumpster delivery and pickup', 1,
            v_pb.delivery_fee_cents, v_pb.delivery_fee_cents);

  elsif v_stop.kind = 'pickup' then
    if v_rental.status not in ('on_site', 'pickup_requested') then
      raise exception 'rental is %', v_rental.status;
    end if;
    update public.rentals set status = 'picked_up', picked_up_at = now() where id = v_rental.id;
    update public.cans set status = 'in_transit' where id = v_rental.can_id;

    v_days := app.company_today(v_stop.company_id) - app.local_date(v_stop.company_id, v_rental.dropped_at);
    v_extra := v_days - v_pb.extended_after_days;
    if v_extra > 0 and v_pb.extended_fee_cents_per_day > 0 then
      insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
      select v_stop.company_id, i.id, 'extended_days',
             format('Extended rental: %s days past %s', v_extra, v_pb.extended_after_days),
             v_extra, v_pb.extended_fee_cents_per_day, v_extra * v_pb.extended_fee_cents_per_day
      from public.invoices i where i.rental_id = v_rental.id;
    end if;

    insert into public.stops (company_id, rental_id, kind, scheduled_date, driver_id, sequence)
    values (v_stop.company_id, v_rental.id, 'dump', v_stop.scheduled_date, v_stop.driver_id, v_stop.sequence + 1);

  else
    raise exception 'record the scale ticket to finish a dump';
  end if;

  update public.stops set status = 'done', completed_at = now(), completed_by = auth.uid()
  where id = v_stop.id;
  perform app.emit(v_stop.company_id, 'rental', v_rental.id, v_stop.kind || '_done',
    jsonb_build_object('stop_id', v_stop.id, 'can_id', coalesce(p_can_id, v_rental.can_id)));
end;
$$;

-- Finishes the dump: records the ticket, adds tonnage at cost, finalizes the
-- invoice and returns the can to the yard.
create function public.record_scale_ticket(
  p_stop_id uuid,
  p_landfill_id uuid,
  p_ticket_number text,
  p_tons numeric,
  p_fee_cents int,
  p_photo_path text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_stop public.stops := app.lock_workable_stop(p_stop_id);
  v_rental public.rentals;
begin
  if v_stop.kind <> 'dump' then raise exception 'not a dump stop'; end if;
  select * into v_rental from public.rentals where id = v_stop.rental_id for update;
  if v_rental.status <> 'picked_up' then raise exception 'rental is %', v_rental.status; end if;
  if p_landfill_id is not null and not exists (
    select 1 from public.landfills where id = p_landfill_id and company_id = v_stop.company_id
  ) then
    raise exception 'landfill not found';
  end if;

  insert into public.scale_tickets (company_id, rental_id, landfill_id, ticket_number, tons, fee_cents, photo_path, entered_by)
  values (v_stop.company_id, v_rental.id, p_landfill_id, nullif(p_ticket_number, ''), p_tons, p_fee_cents, p_photo_path, auth.uid());

  insert into public.invoice_lines (company_id, invoice_id, kind, description, quantity, unit_cents, amount_cents)
  select v_stop.company_id, i.id, 'tonnage',
         format('Disposal: %s tons%s', p_tons, coalesce(', ticket ' || nullif(p_ticket_number, ''), '')),
         p_tons, null, p_fee_cents
  from public.invoices i where i.rental_id = v_rental.id;

  update public.invoices set status = 'final', finalized_at = now()
  where rental_id = v_rental.id and status = 'draft';

  update public.rentals set status = 'closed', dumped_at = now() where id = v_rental.id;
  update public.cans set status = 'available' where id = v_rental.can_id;
  update public.stops set status = 'done', completed_at = now(), completed_by = auth.uid() where id = v_stop.id;

  perform app.emit(v_stop.company_id, 'rental', v_rental.id, 'dump_done',
    jsonb_build_object('tons', p_tons, 'fee_cents', p_fee_cents));
end;
$$;

-- What a driver sees: their stops for a day and nothing that carries a price.
create function public.driver_run(p_date date)
returns table (
  stop_id uuid,
  kind text,
  sequence int,
  status text,
  address text,
  area text,
  lat double precision,
  lng double precision,
  site_notes text,
  rental_notes text,
  customer_name text,
  contact_name text,
  contact_phone text,
  can_id uuid,
  can_label text,
  size_yards int
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.kind, s.sequence, s.status, si.address, si.area, si.lat, si.lng,
         si.notes, r.notes, c.name, cc.name, cc.phone, r.can_id, k.label,
         coalesce(k.size_yards, r.size_yards)
  from public.stops s
  join public.rentals r on r.id = s.rental_id
  join public.sites si on si.id = r.site_id
  join public.customers c on c.id = r.customer_id
  left join public.cans k on k.id = r.can_id
  left join lateral (
    select name, phone from public.customer_contacts
    where customer_id = c.id order by created_at limit 1
  ) cc on true
  where s.company_id = app.current_company_id()
    and s.driver_id = auth.uid()
    and s.scheduled_date = p_date
    and s.status <> 'cancelled'
  order by s.status = 'done', s.sequence, s.created_at
$$;

-- Billing -------------------------------------------------------------------------

-- One statement per customer covering every final invoice not yet billed.
-- Run by the Monday cron (service role) or by staff from the billing page.
create function public.issue_statements(p_company_id uuid default null)
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_today date;
  v_customer record;
  v_statement uuid;
begin
  if auth.uid() is null then
    v_company := p_company_id;  -- service role (cron)
  else
    v_company := app.require_staff();
  end if;
  if v_company is null then raise exception 'company required'; end if;
  v_today := app.company_today(v_company);

  for v_customer in
    select c.id, c.payment_terms_days, c.billing_email, sum(i.total_cents) as total
    from public.invoices i join public.customers c on c.id = i.customer_id
    where i.company_id = v_company and i.status = 'final' and i.statement_id is null
    group by c.id
  loop
    insert into public.statements (company_id, customer_id, number, issued_on, due_on, total_cents)
    values (v_company, v_customer.id, app.next_number(v_company, 'statement'), v_today,
            v_today + v_customer.payment_terms_days, v_customer.total)
    returning id into v_statement;

    update public.invoices set status = 'on_statement', statement_id = v_statement
    where company_id = v_company and customer_id = v_customer.id
      and status = 'final' and statement_id is null;

    perform app.emit(v_company, 'statement', v_statement, 'statement_issued',
      jsonb_build_object('total_cents', v_customer.total));
    if v_customer.billing_email is not null then
      perform app.enqueue(v_company, 'email', 'statement_issued',
        jsonb_build_object('statement_id', v_statement, 'to', v_customer.billing_email),
        'statement:' || v_statement || ':issued');
    end if;
    return next v_statement;
  end loop;
end;
$$;

create function public.record_payment(
  p_statement_id uuid,
  p_amount_cents int,
  p_method text,
  p_reference text,
  p_received_on date
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_statement public.statements;
  v_paid int;
begin
  select * into v_statement from public.statements
  where id = p_statement_id and company_id = v_company for update;
  if v_statement.id is null then raise exception 'statement not found'; end if;
  if v_statement.status = 'void' then raise exception 'statement is void'; end if;

  insert into public.payments (company_id, customer_id, statement_id, amount_cents, method, reference, received_on, recorded_by)
  values (v_company, v_statement.customer_id, v_statement.id, p_amount_cents, p_method,
          nullif(p_reference, ''), p_received_on, auth.uid());

  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where statement_id = v_statement.id;
  if v_paid >= v_statement.total_cents then
    update public.statements set status = 'paid' where id = v_statement.id;
    update public.invoices set status = 'paid' where statement_id = v_statement.id;
  end if;
end;
$$;

-- Overdue reminders at 3 and 5 days past due. Idempotent through dedupe keys,
-- so the daily cron can run it any number of times.
create function public.enqueue_overdue_reminders(p_company_id uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := app.company_today(p_company_id);
  v_row record;
  v_count int := 0;
  v_step int;
begin
  for v_row in
    select s.id, s.due_on, c.billing_email
    from public.statements s join public.customers c on c.id = s.customer_id
    where s.company_id = p_company_id and s.status = 'open' and c.billing_email is not null
      and v_today >= s.due_on + 3
  loop
    foreach v_step in array array[3, 5] loop
      if v_today >= v_row.due_on + v_step then
        perform app.enqueue(p_company_id, 'email', 'statement_reminder',
          jsonb_build_object('statement_id', v_row.id, 'to', v_row.billing_email, 'days_overdue', v_step),
          'statement:' || v_row.id || ':reminder:' || v_step);
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- Weekly numbers for the office dashboard.
create function public.weekly_numbers(p_week_start date)
returns table (
  rentals_dropped int,
  rentals_picked_up int,
  avg_days_out numeric,
  avg_days_pickup_to_invoice numeric,
  cans_in_service int,
  cans_out int,
  unbilled_cents bigint,
  open_balance_cents bigint,
  overdue_cents bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_end date := p_week_start + 7;
begin
  return query
  select
    (select count(*)::int from public.rentals r where r.company_id = v_company
       and app.local_date(v_company, r.dropped_at) >= p_week_start and app.local_date(v_company, r.dropped_at) < v_end),
    (select count(*)::int from public.rentals r where r.company_id = v_company
       and app.local_date(v_company, r.picked_up_at) >= p_week_start and app.local_date(v_company, r.picked_up_at) < v_end),
    (select round(avg(app.local_date(v_company, r.picked_up_at) - app.local_date(v_company, r.dropped_at)), 1)
       from public.rentals r where r.company_id = v_company
       and app.local_date(v_company, r.picked_up_at) >= p_week_start and app.local_date(v_company, r.picked_up_at) < v_end),
    (select round(avg(extract(epoch from i.finalized_at - r.picked_up_at) / 86400)::numeric, 1)
       from public.invoices i join public.rentals r on r.id = i.rental_id
       where i.company_id = v_company and i.finalized_at is not null
       and app.local_date(v_company, i.finalized_at) >= p_week_start and app.local_date(v_company, i.finalized_at) < v_end),
    (select count(*)::int from public.cans k where k.company_id = v_company and k.status <> 'out_of_service'),
    (select count(*)::int from public.cans k where k.company_id = v_company and k.status = 'on_site'),
    (select coalesce(sum(i.total_cents), 0)::bigint from public.invoices i
       where i.company_id = v_company and i.status in ('draft', 'final')),
    (select coalesce(sum(s.total_cents - coalesce(p.paid, 0)), 0)::bigint
       from public.statements s
       left join (select statement_id, sum(amount_cents) as paid from public.payments group by statement_id) p
         on p.statement_id = s.id
       where s.company_id = v_company and s.status = 'open'),
    (select coalesce(sum(s.total_cents - coalesce(p.paid, 0)), 0)::bigint
       from public.statements s
       left join (select statement_id, sum(amount_cents) as paid from public.payments group by statement_id) p
         on p.statement_id = s.id
       where s.company_id = v_company and s.status = 'open' and s.due_on < app.company_today(v_company));
end;
$$;

-- Owner publishes a new price book version; the old one stays for history.
create function public.publish_price_book(
  p_delivery_fee_cents int,
  p_extended_after_days int,
  p_extended_fee_cents_per_day int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.current_company_id();
  v_id uuid;
begin
  if not app.is_owner() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.price_books set is_active = false where company_id = v_company and is_active;
  insert into public.price_books (company_id, version, delivery_fee_cents, extended_after_days,
                                  extended_fee_cents_per_day, created_by)
  select v_company, coalesce(max(version), 0) + 1, p_delivery_fee_cents, p_extended_after_days,
         p_extended_fee_cents_per_day, auth.uid()
  from public.price_books where company_id = v_company
  returning id into v_id;
  return v_id;
end;
$$;

-- Function grants ------------------------------------------------------------------

-- Only the helpers that RLS policies and the rentals_out view evaluate as the
-- caller are executable by signed-in users. Everything else in `app` runs
-- inside SECURITY DEFINER functions and needs no grant.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.current_company_id(), app.member_role(), app.is_staff(), app.is_owner(),
  app.company_today(uuid), app.local_date(uuid, timestamptz)
  to authenticated;
grant execute on all functions in schema app to service_role;

grant execute on function
  public.approve_request(uuid, uuid, date, uuid),
  public.decline_request(uuid, text),
  public.create_rental(uuid, uuid, date, uuid, int, text),
  public.request_pickup(uuid, date, uuid),
  public.assign_stop(uuid, uuid, date),
  public.sequence_stops(uuid[]),
  public.complete_stop(uuid, uuid),
  public.record_scale_ticket(uuid, uuid, text, numeric, int, text),
  public.driver_run(date),
  public.issue_statements(uuid),
  public.record_payment(uuid, int, text, text, date),
  public.weekly_numbers(date),
  public.publish_price_book(int, int, int)
  to authenticated;

revoke execute on function public.submit_rental_request(text, text, text, text, text, text, text, double precision, double precision, text, date, int, text, text) from authenticated;
revoke execute on function public.enqueue_overdue_reminders(uuid) from authenticated;
grant execute on all functions in schema public to service_role;
