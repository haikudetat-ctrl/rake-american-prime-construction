-- Subcontracting: labor-only roofing jobs American Prime does for other
-- contractors (All Season, Rampage, …). From the Oct 21 call, where it was
-- the one thing Andre needed to see before signing.
--
-- How the money works (as Andre described it):
-- - The contractor pays per square: a base rate (All Season $95, Rampage
--   $110) plus $5 a square for each pitch step from 9/12 up, so +$20 at 12/12.
-- - Andre pays his guys the same way: $50 a square base plus the same pitch
--   steps. The squares pay for a job is split evenly among whoever worked it,
--   and the crew changes day to day.
-- - Labor only: no materials.
--
-- Today that's a weekend of WhatsApp archaeology: who went where, how many
-- squares, what pitch, then payroll on Sunday and invoices to the contractors
-- late Sunday night. Late invoices already cost him a $35k receivable.
--
-- So a job is entered in the morning (address, contractor, crew) and closed
-- when it's done (squares, pitch, extras). Closing it freezes the rates,
-- splits the crew pay, and issues the contractor's invoice right then, with
-- the email held 15 minutes so a typo can be fixed first. The weekly payroll
-- is just the done jobs of the week, per worker.
--
-- Staff (owner/office) only. Crews and drivers see none of it. Workflow
-- steps are SECURITY DEFINER functions, like the dumpster and job-costing
-- steps; contractors, the crew roster and the crew rates are edited directly
-- under RLS.

-- Master data -------------------------------------------------------------------

-- What Andre pays his crews (one row per company; defaults from the call).
create table public.sub_settings (
  company_id uuid primary key references public.companies(id),
  crew_cents_per_sq int not null default 5000 check (crew_cents_per_sq >= 0),
  crew_pitch_from int not null default 9 check (crew_pitch_from between 1 and 24),
  crew_pitch_step_cents int not null default 500 check (crew_pitch_step_cents >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- The contractors he works for, each with its own rate sheet.
create table public.sub_contractors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) > 0),
  billing_email text,
  phone text,
  payment_terms_days int not null default 14 check (payment_terms_days between 0 and 120),
  cents_per_sq int not null check (cents_per_sq > 0),
  -- First pitch (x/12) that pays extra, and the extra per square for each step from there.
  pitch_from int not null default 9 check (pitch_from between 1 and 24),
  pitch_step_cents int not null default 500 check (pitch_step_cents >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create trigger sub_contractors_touch before update on public.sub_contractors
  for each row execute function app.touch_updated_at();

-- His guys. They don't sign in; they're names on a job and lines on payroll.
create table public.sub_workers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) > 0),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- Work ----------------------------------------------------------------------------

create table public.sub_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  contractor_id uuid not null references public.sub_contractors(id),
  work_date date not null,
  address text not null check (length(trim(address)) > 0),
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'void')),
  -- Filled when the job is closed. Rates are copied in, so changing a rate
  -- sheet never rewrites a past invoice or payroll.
  squares numeric(8, 2) check (squares > 0),
  pitch int check (pitch between 0 and 24),
  bill_base_cents int,   -- contractor's base rate per square
  bill_pitch_cents int,  -- contractor's pitch extra per square at this pitch
  pay_base_cents int,    -- crew base rate per square
  pay_pitch_cents int,   -- crew pitch extra per square at this pitch
  bill_total_cents int,
  pay_total_cents int,
  done_at timestamptz,
  done_by uuid,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'done' or (squares is not null and pitch is not null and bill_total_cents is not null and pay_total_cents is not null))
);
create index sub_jobs_week_idx on public.sub_jobs(company_id, work_date);
create trigger sub_jobs_touch before update on public.sub_jobs for each row execute function app.touch_updated_at();

-- Who worked the job, and (once it's closed) their share of the pay.
create table public.sub_job_crew (
  company_id uuid not null references public.companies(id),
  job_id uuid not null references public.sub_jobs(id) on delete cascade,
  worker_id uuid not null references public.sub_workers(id),
  pay_cents int check (pay_cents >= 0),
  primary key (job_id, worker_id)
);
create index sub_job_crew_worker_idx on public.sub_job_crew(worker_id);

-- Anything beyond squares: plywood sheets, an extra layer, a second story.
-- What the contractor pays for it and what goes into the crew's pot.
create table public.sub_job_extras (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_id uuid not null references public.sub_jobs(id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  qty numeric(8, 2) not null check (qty > 0),
  bill_unit_cents int not null check (bill_unit_cents >= 0),
  pay_unit_cents int not null check (pay_unit_cents >= 0),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Billing -------------------------------------------------------------------------

-- One invoice per closed job. Numbers come from the same sequence as dumpster
-- invoices, so no two American Prime invoices ever share a number.
create table public.sub_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_id uuid not null references public.sub_jobs(id),
  contractor_id uuid not null references public.sub_contractors(id),
  number int not null,
  issued_on date not null,
  due_on date not null,
  total_cents int not null check (total_cents >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  void_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);
create unique index sub_invoices_one_live_per_job on public.sub_invoices(job_id) where status <> 'void';
create index sub_invoices_open_idx on public.sub_invoices(company_id, due_on) where status = 'open';

create table public.sub_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.sub_invoices(id),
  amount_cents int not null check (amount_cents > 0),
  method text not null check (method in ('check', 'ach', 'cash', 'other')),
  reference text,
  received_on date not null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index sub_payments_invoice_idx on public.sub_payments(invoice_id) where voided_at is null;

-- Audit everything that carries money or who-gets-paid-what.
create trigger sub_settings_audit after insert or update on public.sub_settings for each row execute function app.audit();
create trigger sub_contractors_audit after insert or update on public.sub_contractors for each row execute function app.audit();
create trigger sub_jobs_audit after insert or update on public.sub_jobs for each row execute function app.audit();
create trigger sub_job_crew_audit after insert or update or delete on public.sub_job_crew for each row execute function app.audit();
create trigger sub_job_extras_audit after insert or update or delete on public.sub_job_extras for each row execute function app.audit();
create trigger sub_invoices_audit after insert or update on public.sub_invoices for each row execute function app.audit();
create trigger sub_payments_audit after insert or update on public.sub_payments for each row execute function app.audit();

-- RLS ---------------------------------------------------------------------------------

alter table public.sub_settings enable row level security;
alter table public.sub_contractors enable row level security;
alter table public.sub_workers enable row level security;
alter table public.sub_jobs enable row level security;
alter table public.sub_job_crew enable row level security;
alter table public.sub_job_extras enable row level security;
alter table public.sub_invoices enable row level security;
alter table public.sub_payments enable row level security;

revoke all on public.sub_settings, public.sub_contractors, public.sub_workers, public.sub_jobs,
  public.sub_job_crew, public.sub_job_extras, public.sub_invoices, public.sub_payments
  from anon, authenticated;
grant select on public.sub_settings, public.sub_contractors, public.sub_workers, public.sub_jobs,
  public.sub_job_crew, public.sub_job_extras, public.sub_invoices, public.sub_payments
  to authenticated;
grant insert, update on public.sub_settings, public.sub_contractors, public.sub_workers to authenticated;
grant all on public.sub_settings, public.sub_contractors, public.sub_workers, public.sub_jobs,
  public.sub_job_crew, public.sub_job_extras, public.sub_invoices, public.sub_payments
  to service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sub_settings', 'sub_contractors', 'sub_workers', 'sub_jobs', 'sub_job_crew',
    'sub_job_extras', 'sub_invoices', 'sub_payments'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_staff() and company_id = app.current_company_id())',
      t || '_staff_read', t
    );
  end loop;
  foreach t in array array['sub_settings', 'sub_contractors', 'sub_workers'] loop
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

-- Rate math ------------------------------------------------------------------------------

-- The pitch extra per square: one step at p_pitch_from, one more for each pitch
-- above it. With steps from 9 at $5: 8/12 → $0, 9/12 → $5, 12/12 → $20.
create function app.sub_pitch_cents(p_pitch_from int, p_step_cents int, p_pitch int) returns int
language sql immutable set search_path = '' as $$
  select greatest(0, p_pitch - p_pitch_from + 1) * p_step_cents
$$;

-- Helpers ----------------------------------------------------------------------------------

create function app.staff_sub_job(p_job_id uuid) returns public.sub_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.sub_jobs;
begin
  select * into v_job from public.sub_jobs where id = p_job_id and company_id = app.require_staff() for update;
  if v_job.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  return v_job;
end;
$$;

-- Replaces the crew on a job. Everyone must be on this company's roster.
create function app.set_sub_crew(p_company_id uuid, p_job_id uuid, p_worker_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := array(select distinct w from unnest(coalesce(p_worker_ids, '{}')) as w where w is not null);
begin
  if exists (
    select 1 from unnest(v_ids) as w
    where not exists (select 1 from public.sub_workers s where s.id = w and s.company_id = p_company_id)
  ) then
    raise exception 'worker not found' using errcode = 'P0002';
  end if;
  delete from public.sub_job_crew where job_id = p_job_id and not (worker_id = any(v_ids));
  insert into public.sub_job_crew (company_id, job_id, worker_id)
  select p_company_id, p_job_id, w from unnest(v_ids) as w
  on conflict (job_id, worker_id) do nothing;
end;
$$;

-- Jobs --------------------------------------------------------------------------------------

create function public.create_sub_job(
  p_contractor_id uuid, p_work_date date, p_address text, p_notes text, p_worker_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_id uuid;
begin
  if not exists (select 1 from public.sub_contractors where id = p_contractor_id and company_id = v_company and is_active) then
    raise exception 'pick the contractor' using errcode = 'P0002';
  end if;
  if p_work_date is null then raise exception 'pick the day'; end if;
  if nullif(trim(coalesce(p_address, '')), '') is null then raise exception 'enter the address'; end if;
  insert into public.sub_jobs (company_id, contractor_id, work_date, address, notes, created_by)
  values (v_company, p_contractor_id, p_work_date, trim(p_address), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  perform app.set_sub_crew(v_company, v_id, p_worker_ids);
  perform app.emit(v_company, 'sub_job', v_id, 'sub_job_scheduled', jsonb_build_object('date', p_work_date));
  return v_id;
end;
$$;

-- Change anything about a job that isn't closed yet: day, address, contractor, crew.
create function public.update_sub_job(
  p_job_id uuid, p_contractor_id uuid, p_work_date date, p_address text, p_notes text, p_worker_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
begin
  if v_job.status <> 'scheduled' then raise exception 'reopen the job to change it'; end if;
  if not exists (select 1 from public.sub_contractors where id = p_contractor_id and company_id = v_job.company_id) then
    raise exception 'pick the contractor' using errcode = 'P0002';
  end if;
  if p_work_date is null then raise exception 'pick the day'; end if;
  if nullif(trim(coalesce(p_address, '')), '') is null then raise exception 'enter the address'; end if;
  update public.sub_jobs
  set contractor_id = p_contractor_id, work_date = p_work_date, address = trim(p_address),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = v_job.id;
  perform app.set_sub_crew(v_job.company_id, v_job.id, p_worker_ids);
end;
$$;

create function public.add_sub_job_extra(
  p_job_id uuid, p_description text, p_qty numeric, p_bill_unit_cents int, p_pay_unit_cents int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_id uuid;
begin
  if v_job.status <> 'scheduled' then raise exception 'reopen the job to change it'; end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then raise exception 'say what the extra is'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'enter how many'; end if;
  if coalesce(p_bill_unit_cents, -1) < 0 or coalesce(p_pay_unit_cents, -1) < 0 then
    raise exception 'enter what the contractor pays and what the crew gets (0 is fine)';
  end if;
  insert into public.sub_job_extras (company_id, job_id, description, qty, bill_unit_cents, pay_unit_cents, created_by)
  values (v_job.company_id, v_job.id, trim(p_description), p_qty, p_bill_unit_cents, p_pay_unit_cents, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_sub_job_extra(p_extra_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_extra public.sub_job_extras;
  v_job public.sub_jobs;
begin
  select * into v_extra from public.sub_job_extras where id = p_extra_id and company_id = app.require_staff();
  if v_extra.id is null then raise exception 'extra not found' using errcode = 'P0002'; end if;
  v_job := app.staff_sub_job(v_extra.job_id);
  if v_job.status <> 'scheduled' then raise exception 'reopen the job to change it'; end if;
  delete from public.sub_job_extras where id = v_extra.id;
end;
$$;

-- Close a job: squares and pitch in, crew pay split, contractor invoiced.
create function public.complete_sub_job(p_job_id uuid, p_squares numeric, p_pitch int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_gc public.sub_contractors;
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

-- Undo a close (owner only): voids the unpaid invoice and puts the job back
-- to "scheduled" so the numbers can be fixed. Closing it again issues a new
-- invoice with a new number; the void one stays on record.
create function public.reopen_sub_job(p_job_id uuid, p_reason text) returns void
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
      pay_base_cents = null, pay_pitch_cents = null, bill_total_cents = null, pay_total_cents = null,
      done_at = null, done_by = null
  where id = v_job.id;
  perform app.emit(v_company, 'sub_job', v_job.id, 'sub_job_reopened',
    jsonb_build_object('reason', trim(p_reason), 'voided_invoice', v_invoice.number));
end;
$$;

-- A job that didn't happen (rain, the contractor moved it to someone else).
create function public.cancel_sub_job(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
begin
  if v_job.status <> 'scheduled' then raise exception 'only a job that isn''t closed can be cancelled'; end if;
  update public.sub_jobs set status = 'void', void_reason = nullif(trim(coalesce(p_reason, '')), '') where id = v_job.id;
  perform app.emit(v_job.company_id, 'sub_job', v_job.id, 'sub_job_cancelled', jsonb_build_object('reason', p_reason));
end;
$$;

-- Payments ----------------------------------------------------------------------------------

create function public.record_sub_payment(
  p_invoice_id uuid, p_amount_cents int, p_method text, p_reference text, p_received_on date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_invoice public.sub_invoices;
  v_paid int;
  v_id uuid;
begin
  select * into v_invoice from public.sub_invoices where id = p_invoice_id and company_id = v_company for update;
  if v_invoice.id is null then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if v_invoice.status <> 'open' then raise exception 'invoice #% is %', v_invoice.number, v_invoice.status; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount above zero'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.sub_payments where invoice_id = v_invoice.id and voided_at is null;
  if v_paid + p_amount_cents > v_invoice.total_cents then
    raise exception 'that is more than the % still owed', to_char((v_invoice.total_cents - v_paid) / 100.0, 'FM$999,999,990.00');
  end if;
  insert into public.sub_payments (company_id, invoice_id, amount_cents, method, reference, received_on, created_by)
  values (v_company, v_invoice.id, p_amount_cents, p_method, nullif(trim(coalesce(p_reference, '')), ''),
          coalesce(p_received_on, app.company_today(v_company)), auth.uid())
  returning id into v_id;
  if v_paid + p_amount_cents = v_invoice.total_cents then
    update public.sub_invoices set status = 'paid' where id = v_invoice.id;
  end if;
  perform app.emit(v_company, 'sub_job', v_invoice.job_id, 'sub_payment_recorded',
    jsonb_build_object('amount_cents', p_amount_cents, 'invoice_number', v_invoice.number));
  return v_id;
end;
$$;

create function public.void_sub_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_payment public.sub_payments;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  select * into v_payment from public.sub_payments
  where id = p_payment_id and company_id = v_company and voided_at is null for update;
  if v_payment.id is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  update public.sub_payments set voided_at = now(), void_reason = trim(p_reason) where id = v_payment.id;
  update public.sub_invoices set status = 'open' where id = v_payment.invoice_id and status = 'paid';
end;
$$;

-- Grants --------------------------------------------------------------------------------------

revoke execute on function
  app.sub_pitch_cents(int, int, int), app.staff_sub_job(uuid), app.set_sub_crew(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function
  app.sub_pitch_cents(int, int, int), app.staff_sub_job(uuid), app.set_sub_crew(uuid, uuid, uuid[])
  to service_role;

revoke execute on function
  public.create_sub_job(uuid, date, text, text, uuid[]),
  public.update_sub_job(uuid, uuid, date, text, text, uuid[]),
  public.add_sub_job_extra(uuid, text, numeric, int, int),
  public.remove_sub_job_extra(uuid),
  public.complete_sub_job(uuid, numeric, int),
  public.reopen_sub_job(uuid, text),
  public.cancel_sub_job(uuid, text),
  public.record_sub_payment(uuid, int, text, text, date),
  public.void_sub_payment(uuid, text)
from public, anon;
grant execute on function
  public.create_sub_job(uuid, date, text, text, uuid[]),
  public.update_sub_job(uuid, uuid, date, text, text, uuid[]),
  public.add_sub_job_extra(uuid, text, numeric, int, int),
  public.remove_sub_job_extra(uuid),
  public.complete_sub_job(uuid, numeric, int),
  public.reopen_sub_job(uuid, text),
  public.cancel_sub_job(uuid, text),
  public.record_sub_payment(uuid, int, text, text, date),
  public.void_sub_payment(uuid, text)
to authenticated, service_role;
