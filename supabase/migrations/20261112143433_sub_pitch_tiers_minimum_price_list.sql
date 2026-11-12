-- Subcontracting rates, round 2 (Nov 11 onboarding call with Andrey).
--
-- 1. Pitch extras are tiers, not steps. All Season's new sheet pays +$15 a
--    square at 9/12 and 10/12 and +$20 at 11/12 and 12/12. The old model
--    (one step per pitch from a start pitch) can't say that: entering a $15
--    step from 9/12 bills +$30 at 10/12 and +$60 at 12/12. A tier list says
--    "from this pitch on, this much a square", and a per-pitch step is just
--    a tier at every pitch, so every existing rate converts exactly.
-- 2. A minimum job charge per contractor. Small roofs bill the higher of the
--    squares math or the minimum ($1,400 for All Season), and the top-up is
--    frozen on the job so the invoice prints it as its own line. That line is
--    the point: the minimum is what All Season keeps disputing.
-- 3. A price list per contractor (gutters by the foot, miters each, ...): what
--    the contractor pays and what goes into the crew's pot, per unit. Picking
--    an item adds an ordinary extra to the job with those prices.
-- 4. Gutter-only jobs close at 0 squares, as long as the job has an extra.
--
-- pitch_from / pitch_step_cents and their crew twins stay for this release so
-- the app deployed before it keeps loading; nothing reads them for money any
-- more. Drop them in the next migration.

-- Tiers ---------------------------------------------------------------------------

-- [{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]: pitches strictly
-- increasing from 1 to 24, a whole number of cents up to $1,000 a square.
create function app.valid_pitch_tiers(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  t jsonb;
  v_prev int := 0;
  v_from int;
  v_cents int;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 24 then return false; end if;
  for t in select e.value from jsonb_array_elements(p) as e loop
    if jsonb_typeof(t) <> 'object' or jsonb_typeof(t -> 'from') <> 'number' or jsonb_typeof(t -> 'cents') <> 'number' then
      return false;
    end if;
    if (t ->> 'from') !~ '^\d{1,2}$' or (t ->> 'cents') !~ '^\d{1,6}$' then return false; end if;
    v_from := (t ->> 'from')::int;
    v_cents := (t ->> 'cents')::int;
    if v_from < 1 or v_from > 24 or v_from <= v_prev or v_cents > 100000 then return false; end if;
    v_prev := v_from;
  end loop;
  return true;
end;
$$;

-- The old step model as tiers: one tier at every pitch from p_from to 24.
create function app.linear_pitch_tiers(p_from int, p_step_cents int) returns jsonb
language sql immutable set search_path = '' as $$
  select case when coalesce(p_step_cents, 0) <= 0 then '[]'::jsonb else (
    select jsonb_agg(jsonb_build_object('from', p, 'cents', (p - p_from + 1) * p_step_cents) order by p)
    from generate_series(greatest(p_from, 1), 24) as p
  ) end
$$;

-- The extra per square at a pitch: the highest tier at or below it, else 0.
create function app.sub_tier_cents(p_tiers jsonb, p_pitch int) returns int
language sql immutable set search_path = '' as $$
  select coalesce((
    select (e.value ->> 'cents')::int
    from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) as e
    where (e.value ->> 'from')::int <= p_pitch
    order by (e.value ->> 'from')::int desc
    limit 1
  ), 0)
$$;

-- New contractors default to the old defaults ($5 a step from 9/12); the app
-- always sends its own tiers.
alter table public.sub_contractors
  add column pitch_tiers jsonb not null default app.linear_pitch_tiers(9, 500),
  add column min_job_cents int check (min_job_cents > 0);
update public.sub_contractors set pitch_tiers = app.linear_pitch_tiers(pitch_from, pitch_step_cents);
alter table public.sub_contractors add constraint sub_contractors_pitch_tiers_valid check (app.valid_pitch_tiers(pitch_tiers));

alter table public.sub_settings add column crew_pitch_tiers jsonb not null default app.linear_pitch_tiers(9, 500);
update public.sub_settings set crew_pitch_tiers = app.linear_pitch_tiers(crew_pitch_from, crew_pitch_step_cents);
alter table public.sub_settings add constraint sub_settings_crew_pitch_tiers_valid check (app.valid_pitch_tiers(crew_pitch_tiers));

-- Minimum and gutter-only jobs ------------------------------------------------------

-- The top-up to the contractor's minimum, frozen when the job closes (0 when the
-- squares math cleared it).
alter table public.sub_jobs add column bill_minimum_cents int not null default 0 check (bill_minimum_cents >= 0);
alter table public.sub_jobs drop constraint sub_jobs_squares_check;
alter table public.sub_jobs add constraint sub_jobs_squares_check check (squares >= 0);

-- What an extra is counted in (ft, sq, each...), so the invoice can say "120 ft".
-- Null for extras typed by hand.
alter table public.sub_job_extras add column unit text check (unit in ('sq', 'ft', 'each', 'sheet', 'hour', 'day'));

-- Price list -------------------------------------------------------------------------

create table public.sub_price_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  contractor_id uuid not null references public.sub_contractors(id),
  description text not null check (length(trim(description)) > 0),
  unit text not null default 'each' check (unit in ('sq', 'ft', 'each', 'sheet', 'hour', 'day')),
  bill_unit_cents int not null check (bill_unit_cents >= 0),
  pay_unit_cents int not null check (pay_unit_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contractor_id, description)
);
create index sub_price_items_contractor_idx on public.sub_price_items(contractor_id) where is_active;
create trigger sub_price_items_touch before update on public.sub_price_items
  for each row execute function app.touch_updated_at();
create trigger sub_price_items_audit after insert or update on public.sub_price_items
  for each row execute function app.audit();

alter table public.sub_price_items enable row level security;
revoke all on public.sub_price_items from anon, authenticated;
grant select, insert, update on public.sub_price_items to authenticated;
grant all on public.sub_price_items to service_role;

create policy sub_price_items_staff_read on public.sub_price_items for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
-- The item's contractor must be this company's too, so a price can't be hung
-- on someone else's contractor.
create policy sub_price_items_staff_insert on public.sub_price_items for insert to authenticated
  with check (
    app.is_staff() and company_id = app.current_company_id()
    and exists (select 1 from public.sub_contractors c where c.id = contractor_id and c.company_id = app.current_company_id())
  );
create policy sub_price_items_staff_update on public.sub_price_items for update to authenticated
  using (app.is_staff() and company_id = app.current_company_id())
  with check (
    company_id = app.current_company_id()
    and exists (select 1 from public.sub_contractors c where c.id = contractor_id and c.company_id = app.current_company_id())
  );

-- Adds a price-list item to an open job as an extra, at the list's prices. The
-- item has to be the job's own contractor's, so one contractor's prices never
-- land on another's invoice.
create function public.add_sub_job_price_item(p_job_id uuid, p_item_id uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_item public.sub_price_items;
  v_id uuid;
begin
  if v_job.status <> 'scheduled' then raise exception 'reopen the job to change it'; end if;
  select * into v_item from public.sub_price_items where id = p_item_id and company_id = v_job.company_id and is_active;
  if v_item.id is null then raise exception 'pick an item from the price list' using errcode = 'P0002'; end if;
  if v_item.contractor_id <> v_job.contractor_id then
    raise exception 'that item is on another contractor''s price list';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 99999 then raise exception 'enter how many'; end if;
  insert into public.sub_job_extras (company_id, job_id, description, qty, unit, bill_unit_cents, pay_unit_cents, created_by)
  values (v_job.company_id, v_job.id, v_item.description, p_qty, v_item.unit, v_item.bill_unit_cents, v_item.pay_unit_cents, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Fingerprint: rates now means the tiers and the minimum ------------------------------

create or replace function app.sub_closeout_fingerprint(p_job_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'crew', md5(coalesce((
      select jsonb_agg(jsonb_build_array(w.id, w.name) order by w.name, w.id)
      from public.sub_job_crew c join public.sub_workers w on w.id = c.worker_id
      where c.job_id = j.id
    ), '[]'::jsonb)::text),
    'extras', md5(coalesce((
      select jsonb_agg(jsonb_build_array(e.id, e.description, e.qty, e.bill_unit_cents, e.pay_unit_cents) order by e.id)
      from public.sub_job_extras e where e.job_id = j.id
    ), '[]'::jsonb)::text),
    'rates', md5(jsonb_build_array(
      g.cents_per_sq, g.pitch_tiers, g.min_job_cents,
      coalesce(s.crew_cents_per_sq, 5000), coalesce(s.crew_pitch_tiers, app.linear_pitch_tiers(9, 500))
    )::text),
    'contractor', md5(jsonb_build_array(g.id, nullif(trim(coalesce(g.billing_email, '')), ''), g.payment_terms_days)::text)
  )
  from public.sub_jobs j
  join public.sub_contractors g on g.id = j.contractor_id
  left join public.sub_settings s on s.company_id = j.company_id
  where j.id = p_job_id
$$;

-- Close a job --------------------------------------------------------------------------

create or replace function public.complete_sub_job(
  p_job_id uuid, p_squares numeric, p_pitch int, p_expected_fingerprint jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  -- staff_sub_job locks the job row, and every edit to its crew or extras goes
  -- through the same lock, so nothing can change between this check and the insert.
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_gc public.sub_contractors;
  v_changed text;
  v_has_extras boolean;
  v_crew_base int;
  v_crew_tiers jsonb;
  v_bill_pitch int;
  v_pay_pitch int;
  v_bill int;
  v_pay int;
  v_minimum int := 0;
  v_crew int;
  v_share int;
  v_left int;
  v_i int := 0;
  v_worker record;
  v_today date;
  v_invoice uuid;
  v_number int;
begin
  if v_job.status <> 'scheduled' then raise exception 'job is already %', v_job.status; end if;
  if p_expected_fingerprint is not null then
    select string_agg(cur.key, ',' order by cur.key) into v_changed
    from jsonb_each_text(app.sub_closeout_fingerprint(v_job.id)) as cur
    where cur.value is distinct from p_expected_fingerprint ->> cur.key;
    if v_changed is not null then
      raise exception 'work changed during review' using errcode = 'P0001', hint = 'stale_review', detail = v_changed;
    end if;
  end if;
  v_has_extras := exists (select 1 from public.sub_job_extras where job_id = v_job.id);
  -- 0 squares is a gutter (or other extras-only) job; it needs something to bill.
  if p_squares is null or p_squares < 0 or p_squares > 999 or (p_squares = 0 and not v_has_extras) then
    raise exception 'enter the squares';
  end if;
  if p_pitch is null or p_pitch < 0 or p_pitch > 24 then raise exception 'enter the pitch (0 to 24)'; end if;
  select count(*) into v_crew from public.sub_job_crew where job_id = v_job.id;
  if v_crew = 0 then raise exception 'pick who worked the job first'; end if;

  select * into v_gc from public.sub_contractors where id = v_job.contractor_id;
  select coalesce(s.crew_cents_per_sq, 5000), coalesce(s.crew_pitch_tiers, app.linear_pitch_tiers(9, 500))
    into v_crew_base, v_crew_tiers
  from (select 1) as one left join public.sub_settings s on s.company_id = v_job.company_id;

  v_bill_pitch := case when p_squares > 0 then app.sub_tier_cents(v_gc.pitch_tiers, p_pitch) else 0 end;
  v_pay_pitch := case when p_squares > 0 then app.sub_tier_cents(v_crew_tiers, p_pitch) else 0 end;
  v_bill := round(p_squares * (v_gc.cents_per_sq + v_bill_pitch))
    + coalesce((select sum(round(qty * bill_unit_cents)) from public.sub_job_extras where job_id = v_job.id), 0);
  v_pay := round(p_squares * (v_crew_base + v_pay_pitch))
    + coalesce((select sum(round(qty * pay_unit_cents)) from public.sub_job_extras where job_id = v_job.id), 0);

  -- The minimum is for roofs (squares on the job), not a gutter-only visit.
  if p_squares > 0 and v_gc.min_job_cents is not null and v_bill < v_gc.min_job_cents then
    v_minimum := v_gc.min_job_cents - v_bill;
    v_bill := v_gc.min_job_cents;
  end if;

  -- Even split; the leftover cents go one each to the first names, so the
  -- shares always add up to the job's pay exactly.
  v_share := v_pay / v_crew;
  v_left := v_pay - v_share * v_crew;
  for v_worker in
    select c.worker_id from public.sub_job_crew c join public.sub_workers w on w.id = c.worker_id
    where c.job_id = v_job.id order by w.name, w.id
  loop
    update public.sub_job_crew set pay_cents = v_share + case when v_i < v_left then 1 else 0 end
    where job_id = v_job.id and worker_id = v_worker.worker_id;
    v_i := v_i + 1;
  end loop;

  update public.sub_jobs
  set status = 'done', squares = p_squares, pitch = p_pitch,
      bill_base_cents = v_gc.cents_per_sq, bill_pitch_cents = v_bill_pitch, bill_minimum_cents = v_minimum,
      pay_base_cents = v_crew_base, pay_pitch_cents = v_pay_pitch,
      bill_total_cents = v_bill, pay_total_cents = v_pay,
      done_at = now(), done_by = auth.uid()
  where id = v_job.id;

  v_today := app.company_today(v_job.company_id);
  v_number := app.next_number(v_job.company_id, 'invoice');
  insert into public.sub_invoices (company_id, job_id, contractor_id, number, issued_on, due_on, total_cents)
  values (v_job.company_id, v_job.id, v_gc.id, v_number, v_today, v_today + v_gc.payment_terms_days, v_bill)
  returning id into v_invoice;

  -- Held 15 minutes so a wrong number can be fixed (reopening voids the
  -- invoice, and the delivery skips a void one) before the contractor sees it.
  if nullif(trim(coalesce(v_gc.billing_email, '')), '') is not null then
    perform app.enqueue(v_job.company_id, 'email', 'sub_invoice_issued',
      jsonb_build_object('invoice_id', v_invoice, 'to', trim(v_gc.billing_email)),
      'sub_invoice:' || v_invoice || ':issued', now() + interval '15 minutes');
  end if;

  perform app.emit(v_job.company_id, 'sub_job', v_job.id, 'sub_job_done',
    jsonb_build_object('squares', p_squares, 'pitch', p_pitch, 'bill_cents', v_bill, 'pay_cents', v_pay,
                       'minimum_cents', v_minimum, 'invoice_number', v_number));
  return v_invoice;
end;
$$;

-- Reopening also clears the frozen minimum.
create or replace function public.reopen_sub_job(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_invoice public.sub_invoices;
begin
  if v_job.status <> 'done' then raise exception 'only a closed job can be reopened'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  select * into v_invoice from public.sub_invoices where job_id = v_job.id and status <> 'void' for update;
  if v_invoice.status = 'paid' or exists (
    select 1 from public.sub_payments where invoice_id = v_invoice.id and voided_at is null
  ) then
    raise exception 'invoice #% has a payment on it; void the payment first', v_invoice.number;
  end if;
  update public.sub_invoices set status = 'void', void_reason = trim(p_reason) where id = v_invoice.id;
  update public.sub_job_crew set pay_cents = null where job_id = v_job.id;
  update public.sub_jobs
  set status = 'scheduled', squares = null, pitch = null, bill_base_cents = null, bill_pitch_cents = null,
      bill_minimum_cents = 0, pay_base_cents = null, pay_pitch_cents = null, bill_total_cents = null,
      pay_total_cents = null, done_at = null, done_by = null
  where id = v_job.id;
  perform app.emit(v_company, 'sub_job', v_job.id, 'sub_job_reopened',
    jsonb_build_object('reason', trim(p_reason), 'voided_invoice', v_invoice.number));
end;
$$;

-- Grants ----------------------------------------------------------------------------------

revoke execute on function
  app.valid_pitch_tiers(jsonb), app.linear_pitch_tiers(int, int), app.sub_tier_cents(jsonb, int)
from public, anon;
-- The check constraints and column defaults run as whoever writes the row.
grant execute on function app.valid_pitch_tiers(jsonb), app.linear_pitch_tiers(int, int) to authenticated;
grant execute on function
  app.valid_pitch_tiers(jsonb), app.linear_pitch_tiers(int, int), app.sub_tier_cents(jsonb, int)
to service_role;

revoke execute on function public.add_sub_job_price_item(uuid, uuid, numeric) from public, anon;
grant execute on function public.add_sub_job_price_item(uuid, uuid, numeric) to authenticated, service_role;
