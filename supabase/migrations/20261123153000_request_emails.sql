-- Dumpster requests by email (Nov 23).
--
-- Andrey: "if the system is not open and you are not looking at it you will
-- never know that someone put a request on it", and the customer hears nothing
-- once it's approved.
--
-- A new request already texted staff, but only those with a phone on their
-- profile, and neither owner had one. A booking already texted the customer,
-- but customer texts can't go out until American Prime's own texting
-- registration is approved, so every one has failed.
--
-- Now both also go by email, from the DropWise brand:
--   submit_rental_request  every active owner and office login, at their sign-in address;
--   approve_request        the customer, at the email on the request form.
-- The texts stay as they were. Both functions are otherwise unchanged
-- (submit_rental_request as roofing_leads left it, approve_request as dumpster did).

create or replace function public.submit_rental_request(
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
  v_email record;
begin
  select l.* into v_link from public.request_links l
  join public.brands b on b.id = l.brand_id
  where l.slug = p_slug and l.is_active and b.kind = 'dumpster';
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

  -- And by email (Nov 23). Texts only reach staff with a phone on their
  -- profile, so the owner never heard about a request unless Rake was open.
  -- Every owner and office login gets one, at the address they sign in with.
  for v_email in
    select u.email, p.locale from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.company_id = v_link.company_id and m.is_active
      and m.role in ('owner', 'office') and nullif(trim(u.email), '') is not null
  loop
    perform app.enqueue(
      v_link.company_id, 'email', 'request_received',
      jsonb_build_object(
        'to', v_email.email, 'locale', coalesce(v_email.locale, 'en'), 'request_id', v_id,
        'name', coalesce(nullif(p_company_name, ''), p_contact_name),
        'contact', p_contact_name, 'phone', p_phone, 'email', nullif(p_email, ''),
        'date', p_requested_date, 'address', p_address, 'notes', nullif(p_notes, '')
      ),
      'request:' || v_id || ':notify:' || lower(v_email.email)
    );
  end loop;

  return v_id;
end;
$$;

create or replace function public.approve_request(
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
  -- The text above can't reach customers until American Prime's own texting
  -- registration is approved, so the booking also goes by email (Nov 23).
  -- Every request form asks for an email.
  if nullif(trim(coalesce(v_req.email, '')), '') is not null then
    perform app.enqueue(
      v_company, 'email', 'request_approved',
      jsonb_build_object('to', trim(v_req.email), 'name', v_req.contact_name,
                         'date', coalesce(p_drop_date, v_req.requested_date),
                         'address', v_req.address, 'size_yards', v_req.size_yards, 'rental_id', v_rental),
      'request:' || v_req.id || ':approved:email'
    );
  end if;
  return v_rental;
end;
$$;
