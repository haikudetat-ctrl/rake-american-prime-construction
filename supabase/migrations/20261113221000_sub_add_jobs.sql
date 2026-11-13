-- Adding subcontract jobs quickly, several at once, and after the fact (Nov 13).
--
-- Andre forgets to put jobs in. By the weekend there's a job from Tuesday that
-- never made it into Rake, so it has no invoice and the crew has no earnings
-- for it. Adding it meant three steps on two screens (add, then extras one at
-- a time, then close), once per job. And All Season's week arrives as a list
-- of addresses, which went in one form at a time.
--
-- add_sub_jobs takes a list of jobs and does all of it in one transaction:
--   - each job is created exactly as create_sub_job does it;
--   - items picked from the contractor's price list go on as extras, exactly
--     as add_sub_job_price_item does it;
--   - a job that comes with its squares is closed right away by
--     complete_sub_job, so its invoice and crew pay are the same as any other.
-- One bad job refuses the whole list, and the error names the job by its
-- place in the list, so nothing is half-added and the office fixes one line.
--
-- Two guards that matter more for jobs entered from memory:
--   - The same contractor, day and address twice (in the list, or already in
--     Rake) is refused. Double-billing All Season is the expensive mistake.
--   - A closed job carries the bill and crew totals the office was shown.
--     If the database works out different ones (a rate changed while the list
--     was being typed) nothing is saved. This is the bulk version of the
--     closeout fingerprint: what was reviewed is what gets billed.
-- A job dated after today can be added, but not closed.

-- "12 Oak St." and "12 oak st" are the same address for the duplicate check.
create function app.sub_address_key(p_address text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p_address, '')), '[^a-z0-9]+', '', 'g')
$$;

-- Several price-list items on one open job: [{"item_id": "…", "qty": 120}, …].
create function public.add_sub_job_price_items(p_job_id uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_count int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pick at least one item';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'pick up to 50 items at a time'; end if;
  if (select count(distinct e.value ->> 'item_id') from jsonb_array_elements(p_items) as e) < jsonb_array_length(p_items) then
    raise exception 'an item is picked twice; put the total in one line';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item -> 'qty'), '') <> 'number' then
      raise exception 'enter how many for each item';
    end if;
    -- add_sub_job_price_item checks the job is open, the item is on this
    -- job's contractor's list, and the quantity.
    perform public.add_sub_job_price_item(p_job_id, (v_item ->> 'item_id')::uuid, (v_item ->> 'qty')::numeric);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- A list of jobs, each:
--   {"contractor_id", "work_date", "address", "notes", "worker_ids": [],
--    "items": [{"item_id", "qty"}],
--    "squares", "pitch", "expected_bill_cents", "expected_pay_cents"}
-- squares (and pitch, unless squares is 0) close the job now; without them it
-- stays scheduled. Returns [{"job_id", "invoice_id", "invoice_number"}], the
-- invoice fields null for a job left open.
create function public.add_sub_jobs(p_jobs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_today date := app.company_today(v_company);
  v_job jsonb;
  v_n int := 0;
  v_contractor uuid;
  v_date date;
  v_address text;
  v_key text;
  v_seen text[] := '{}';
  v_squares numeric;
  v_pitch int;
  v_id uuid;
  v_invoice uuid;
  v_number int;
  v_row public.sub_jobs;
  v_out jsonb := '[]'::jsonb;
  v_msg text;
  v_hint text;
  v_state text;
begin
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'add at least one job';
  end if;
  if jsonb_array_length(p_jobs) > 50 then raise exception 'add up to 50 jobs at a time'; end if;

  for v_job in select e.value from jsonb_array_elements(p_jobs) as e loop
    v_n := v_n + 1;
    begin
      if jsonb_typeof(v_job) <> 'object' then raise exception 'it isn''t a job'; end if;
      v_contractor := nullif(v_job ->> 'contractor_id', '')::uuid;
      v_date := nullif(v_job ->> 'work_date', '')::date;
      v_address := trim(coalesce(v_job ->> 'address', ''));
      v_squares := nullif(v_job ->> 'squares', '')::numeric;
      v_pitch := nullif(v_job ->> 'pitch', '')::int;

      v_key := concat_ws('|', v_contractor, v_date, app.sub_address_key(v_address));
      if v_key = any(v_seen) then
        raise exception '% on % is in this list twice', v_address, to_char(v_date, 'Mon FMDD');
      end if;
      v_seen := v_seen || v_key;
      if exists (
        select 1 from public.sub_jobs j
        where j.company_id = v_company and j.contractor_id = v_contractor and j.work_date = v_date
          and j.status <> 'void' and app.sub_address_key(j.address) = app.sub_address_key(v_address)
      ) then
        raise exception '% on % is already in Rake for this contractor', v_address, to_char(v_date, 'Mon FMDD');
      end if;

      v_id := public.create_sub_job(
        v_contractor, v_date, v_address, v_job ->> 'notes',
        array(select w::uuid from jsonb_array_elements_text(coalesce(v_job -> 'worker_ids', '[]'::jsonb)) as w)
      );
      if jsonb_typeof(v_job -> 'items') = 'array' and jsonb_array_length(v_job -> 'items') > 0 then
        perform public.add_sub_job_price_items(v_id, v_job -> 'items');
      end if;

      v_invoice := null;
      v_number := null;
      if v_squares is not null then
        if v_date > v_today then raise exception 'it''s dated after today, so it can''t be closed yet'; end if;
        if coalesce(jsonb_typeof(v_job -> 'expected_bill_cents'), '') <> 'number'
          or coalesce(jsonb_typeof(v_job -> 'expected_pay_cents'), '') <> 'number' then
          raise exception 'review its totals before closing it';
        end if;
        v_invoice := public.complete_sub_job(v_id, v_squares, case when v_squares = 0 then coalesce(v_pitch, 0) else v_pitch end, null);
        select * into v_row from public.sub_jobs where id = v_id;
        if v_row.bill_total_cents is distinct from (v_job ->> 'expected_bill_cents')::int
          or v_row.pay_total_cents is distinct from (v_job ->> 'expected_pay_cents')::int then
          raise exception 'its totals changed while you were adding it (rates now bill %, crew %)',
            to_char(v_row.bill_total_cents / 100.0, 'FM$999,999,990.00'), to_char(v_row.pay_total_cents / 100.0, 'FM$999,999,990.00')
            using hint = 'stale_review';
        end if;
        select number into v_number from public.sub_invoices where id = v_invoice;
      end if;

      v_out := v_out || jsonb_build_object('job_id', v_id, 'invoice_id', v_invoice, 'invoice_number', v_number);
    exception when others then
      -- Name the job, keep the code and hint. Raising here undoes the whole list.
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_state = returned_sqlstate;
      raise exception 'Job %: %', v_n, v_msg using errcode = v_state, hint = coalesce(v_hint, ''), detail = 'job:' || v_n;
    end;
  end loop;
  -- Each job's history already has its scheduled (and done) events, stamped
  -- with when they were entered, so a job added late shows as added late.
  return v_out;
end;
$$;

revoke execute on function app.sub_address_key(text) from public, anon, authenticated;
grant execute on function app.sub_address_key(text) to service_role;

revoke execute on function public.add_sub_job_price_items(uuid, jsonb), public.add_sub_jobs(jsonb) from public, anon;
grant execute on function public.add_sub_job_price_items(uuid, jsonb), public.add_sub_jobs(jsonb) to authenticated, service_role;
