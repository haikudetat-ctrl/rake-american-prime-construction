-- Closeout version check (Figma V2 #85).
--
-- complete_sub_job recomputes the invoice and crew pay from whatever the crew,
-- extras and rates are when it runs. The office reviews those numbers first, so
-- an edit made in between (another tab, another person, a rate change) used to
-- invoice amounts nobody checked. The review now carries a fingerprint of what
-- it showed, and closing refuses when the fingerprint no longer matches.
--
-- The fingerprint is split by what can change, so the refusal can name it:
--   crew        who worked the job (names too: the leftover cents go by name order)
--   extras      every extra line, its quantity and both unit prices
--   rates       the contractor's and the crew's per-square and pitch rates
--   contractor  which contractor is billed, their billing email and terms
-- The job's address, date and notes are left out on purpose: editing them does
-- not change any amount or recipient, so it should not block a closeout.

create function app.sub_closeout_fingerprint(p_job_id uuid) returns jsonb
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
    -- The crew defaults match complete_sub_job's, so a missing settings row
    -- fingerprints the same as the rates it will actually apply.
    'rates', md5(jsonb_build_array(
      g.cents_per_sq, g.pitch_from, g.pitch_step_cents,
      coalesce(s.crew_cents_per_sq, 5000), coalesce(s.crew_pitch_from, 9), coalesce(s.crew_pitch_step_cents, 500)
    )::text),
    'contractor', md5(jsonb_build_array(g.id, nullif(trim(coalesce(g.billing_email, '')), ''), g.payment_terms_days)::text)
  )
  from public.sub_jobs j
  join public.sub_contractors g on g.id = j.contractor_id
  left join public.sub_settings s on s.company_id = j.company_id
  where j.id = p_job_id
$$;

revoke all on function app.sub_closeout_fingerprint(uuid) from public;

-- What the closeout review renders into its form. Staff only, own company only.
create function public.sub_job_closeout_fingerprint(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id from public.sub_jobs where id = p_job_id and company_id = app.require_staff();
  if v_job_id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  return app.sub_closeout_fingerprint(v_job_id);
end;
$$;

-- Same function as before, plus p_expected_fingerprint. It defaults to null so
-- the app version deployed before this migration keeps closing jobs during the
-- rollout; the app from this release always sends it.
drop function public.complete_sub_job(uuid, numeric, int);

create function public.complete_sub_job(
  p_job_id uuid, p_squares numeric, p_pitch int, p_expected_fingerprint jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  -- staff_sub_job locks the job row, and every edit to its crew or extras goes
  -- through the same lock, so nothing can change between this check and the insert.
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_gc public.sub_contractors;
  v_changed text;
  v_crew_base int;
  v_crew_from int;
  v_crew_step int;
  v_bill_pitch int;
  v_pay_pitch int;
  v_bill int;
  v_pay int;
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
  if p_squares is null or p_squares <= 0 or p_squares > 999 then raise exception 'enter the squares'; end if;
  if p_pitch is null or p_pitch < 0 or p_pitch > 24 then raise exception 'enter the pitch (0 to 24)'; end if;
  select count(*) into v_crew from public.sub_job_crew where job_id = v_job.id;
  if v_crew = 0 then raise exception 'pick who worked the job first'; end if;

  select * into v_gc from public.sub_contractors where id = v_job.contractor_id;
  select coalesce(s.crew_cents_per_sq, 5000), coalesce(s.crew_pitch_from, 9), coalesce(s.crew_pitch_step_cents, 500)
    into v_crew_base, v_crew_from, v_crew_step
  from (select 1) as one left join public.sub_settings s on s.company_id = v_job.company_id;

  v_bill_pitch := app.sub_pitch_cents(v_gc.pitch_from, v_gc.pitch_step_cents, p_pitch);
  v_pay_pitch := app.sub_pitch_cents(v_crew_from, v_crew_step, p_pitch);
  v_bill := round(p_squares * (v_gc.cents_per_sq + v_bill_pitch))
    + coalesce((select sum(round(qty * bill_unit_cents)) from public.sub_job_extras where job_id = v_job.id), 0);
  v_pay := round(p_squares * (v_crew_base + v_pay_pitch))
    + coalesce((select sum(round(qty * pay_unit_cents)) from public.sub_job_extras where job_id = v_job.id), 0);

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
      bill_base_cents = v_gc.cents_per_sq, bill_pitch_cents = v_bill_pitch,
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
                       'invoice_number', v_number));
  return v_invoice;
end;
$$;

revoke execute on function
  public.sub_job_closeout_fingerprint(uuid),
  public.complete_sub_job(uuid, numeric, int, jsonb)
from public, anon;
grant execute on function
  public.sub_job_closeout_fingerprint(uuid),
  public.complete_sub_job(uuid, numeric, int, jsonb)
to authenticated, service_role;
