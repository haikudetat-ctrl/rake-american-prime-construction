-- Drop and pickup photos (Oct 21 call).
--
-- A drop isn't done until the driver photographs where the can sits and the
-- area around it (proof we didn't damage the property, and that the right can
-- went to the right job). A pickup isn't done until the driver photographs
-- the load before lifting it (a can a neighbor filled is the customer's
-- tonnage dispute; the photo settles it). complete_stop refuses either step
-- without at least one photo, so the rule holds whatever screen calls it.
--
-- Photos live in a private bucket, uploaded by the server (service role) and
-- shown to staff by signed URL, like scale tickets. Undoing a step keeps its
-- photos: they're evidence of what was there at the time.

create table public.stop_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  stop_id uuid not null references public.stops(id),
  rental_id uuid not null references public.rentals(id),
  kind text not null check (kind in ('drop', 'pickup')),
  path text not null unique,
  taken_by uuid,
  taken_at timestamptz not null default now()
);
create index stop_photos_rental_idx on public.stop_photos(rental_id, taken_at);

create trigger stop_photos_audit after insert or update or delete on public.stop_photos
  for each row execute function app.audit();

alter table public.stop_photos enable row level security;
revoke all on public.stop_photos from anon, authenticated;
grant select on public.stop_photos to authenticated;
grant all on public.stop_photos to service_role;
create policy stop_photos_staff_read on public.stop_photos for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('stop-photos', 'stop-photos', false, 10485760,
            array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- complete_stop now takes the photo paths. The two-argument version is dropped
-- so nothing can still complete a drop or pickup without one.
drop function public.complete_stop(uuid, uuid);

create function public.complete_stop(p_stop_id uuid, p_can_id uuid default null, p_photo_paths text[] default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_stop public.stops := app.lock_workable_stop(p_stop_id);
  v_rental public.rentals;
  v_pb public.price_books;
  v_invoice uuid;
  v_days int;
  v_extra int;
  v_photos text[] := array(select distinct p from unnest(coalesce(p_photo_paths, '{}')) as p where nullif(trim(p), '') is not null);
begin
  if v_stop.kind in ('drop', 'pickup') then
    if cardinality(v_photos) = 0 then
      raise exception '%', case v_stop.kind
        when 'drop' then 'take a photo of where the can is placed first'
        else 'take a photo of the load first' end
        using errcode = '22023';
    end if;
    if cardinality(v_photos) > 4 then raise exception 'up to 4 photos per stop'; end if;
    -- Uploaded by the server under the company's folder; anything else isn't ours.
    if exists (select 1 from unnest(v_photos) as p where p not like v_stop.company_id::text || '/%') then
      raise exception 'photo not found';
    end if;
  end if;

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

  insert into public.stop_photos (company_id, stop_id, rental_id, kind, path, taken_by)
  select v_stop.company_id, v_stop.id, v_rental.id, v_stop.kind, p, auth.uid()
  from unnest(v_photos) as p;

  update public.stops set status = 'done', completed_at = now(), completed_by = auth.uid()
  where id = v_stop.id;
  perform app.emit(v_stop.company_id, 'rental', v_rental.id, v_stop.kind || '_done',
    jsonb_build_object('stop_id', v_stop.id, 'can_id', coalesce(p_can_id, v_rental.can_id),
                       'photos', cardinality(v_photos)));
end;
$$;

revoke execute on function public.complete_stop(uuid, uuid, text[]) from public, anon;
grant execute on function public.complete_stop(uuid, uuid, text[]) to authenticated, service_role;
