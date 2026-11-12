-- Weekly billing for subcontracting (Nov 11 call: "make all the invoices for
-- one company ... at the end of the week").
--
-- Closing a job still issues its own numbered invoice: that is the line the
-- crew pay, reopening and payments hang on. What changes is what the
-- contractor receives. A contractor billed weekly gets nothing when a job
-- closes; their closed jobs collect until a statement is issued, either by
-- the Monday cron (everything worked through the Sunday before) or by the
-- office from the Statements page. The statement lists every job with its
-- invoice, goes out as one email with one PDF, and is paid with one check that
-- the database spreads over its invoices, oldest first.
--
-- Contractors can stay on an invoice per job; all of them start weekly, which
-- is what Andrey asked for.

alter table public.sub_contractors
  add column billing text not null default 'weekly' check (billing in ('weekly', 'per_job'));

create table public.sub_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  contractor_id uuid not null references public.sub_contractors(id),
  number int not null,
  -- The first and last work dates on it, for the heading ("Work Nov 9 to Nov 13").
  period_start date not null,
  period_end date not null,
  issued_on date not null,
  due_on date not null,
  total_cents int not null check (total_cents >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  void_reason text,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);
create index sub_statements_open_idx on public.sub_statements(company_id, due_on) where status = 'open';
create trigger sub_statements_audit after insert or update on public.sub_statements
  for each row execute function app.audit();

alter table public.sub_invoices add column statement_id uuid references public.sub_statements(id);
create index sub_invoices_statement_idx on public.sub_invoices(statement_id) where statement_id is not null;

alter table public.sub_statements enable row level security;
revoke all on public.sub_statements from anon, authenticated;
grant select on public.sub_statements to authenticated;
grant all on public.sub_statements to service_role;
create policy sub_statements_staff_read on public.sub_statements for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Helpers ----------------------------------------------------------------------------------

-- A statement is paid when every invoice on it is; a payment voided later opens it again.
create function app.sync_sub_statement(p_statement_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.sub_statements s
  set status = case
    when not exists (select 1 from public.sub_invoices i where i.statement_id = s.id and i.status = 'open') then 'paid'
    else 'open' end
  where s.id = p_statement_id and s.status <> 'void'
$$;

-- Puts every unbilled, open invoice of one contractor for work through p_through
-- on a new statement and queues its email. Null when there is nothing to bill.
create function app.issue_sub_statement(p_company_id uuid, p_contractor_id uuid, p_through date, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_gc public.sub_contractors;
  v_today date := app.company_today(p_company_id);
  v_start date;
  v_end date;
  v_total int;
  v_count int;
  v_id uuid;
  v_number int;
begin
  select * into v_gc from public.sub_contractors where id = p_contractor_id and company_id = p_company_id for update;
  if v_gc.id is null then raise exception 'contractor not found' using errcode = 'P0002'; end if;

  select min(j.work_date), max(j.work_date), coalesce(sum(i.total_cents), 0), count(*)
    into v_start, v_end, v_total, v_count
  from public.sub_invoices i join public.sub_jobs j on j.id = i.job_id
  where i.contractor_id = v_gc.id and i.status = 'open' and i.statement_id is null and j.work_date <= p_through;
  if v_count = 0 then return null; end if;

  v_number := app.next_number(p_company_id, 'statement');
  insert into public.sub_statements (company_id, contractor_id, number, period_start, period_end, issued_on, due_on, total_cents, created_by)
  values (p_company_id, v_gc.id, v_number, v_start, v_end, v_today, v_today + v_gc.payment_terms_days, v_total, p_actor)
  returning id into v_id;

  -- The invoices now fall due with the statement.
  update public.sub_invoices i
  set statement_id = v_id, due_on = v_today + v_gc.payment_terms_days
  from public.sub_jobs j
  where j.id = i.job_id and i.contractor_id = v_gc.id and i.status = 'open' and i.statement_id is null
    and j.work_date <= p_through;

  if nullif(trim(coalesce(v_gc.billing_email, '')), '') is not null then
    perform app.enqueue(p_company_id, 'email', 'sub_statement_issued',
      jsonb_build_object('statement_id', v_id, 'to', trim(v_gc.billing_email)),
      'sub_statement:' || v_id || ':issued');
  end if;
  perform app.emit(p_company_id, 'sub_statement', v_id, 'sub_statement_issued',
    jsonb_build_object('number', v_number, 'contractor', v_gc.name, 'jobs', v_count, 'total_cents', v_total));
  return v_id;
end;
$$;

-- Office: bill one contractor now, for everything closed through a day (default today).
create function public.issue_sub_statement(p_contractor_id uuid, p_through date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_id uuid;
begin
  v_id := app.issue_sub_statement(v_company, p_contractor_id, coalesce(p_through, app.company_today(v_company)), auth.uid());
  if v_id is null then raise exception 'nothing to bill: no closed jobs waiting for a statement'; end if;
  return v_id;
end;
$$;

-- Monday cron: every weekly contractor, for work through the Sunday before.
-- Running it twice bills nothing twice: billed invoices are on a statement.
create function public.issue_sub_statements(p_company_id uuid) returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_through date := date_trunc('week', app.company_today(p_company_id))::date - 1;
  v_gc record;
  v_id uuid;
begin
  for v_gc in
    select id from public.sub_contractors where company_id = p_company_id and billing = 'weekly' order by name
  loop
    v_id := app.issue_sub_statement(p_company_id, v_gc.id, v_through, null);
    if v_id is not null then return next v_id; end if;
  end loop;
end;
$$;

-- One check for a statement, spread over its unpaid invoices, oldest first.
create function public.record_sub_statement_payment(
  p_statement_id uuid, p_amount_cents int, p_method text, p_reference text, p_received_on date
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_statement public.sub_statements;
  v_left int := p_amount_cents;
  v_balance int;
  v_part int;
  v_invoice record;
begin
  select * into v_statement from public.sub_statements where id = p_statement_id and company_id = v_company for update;
  if v_statement.id is null then raise exception 'statement not found' using errcode = 'P0002'; end if;
  if v_statement.status <> 'open' then raise exception 'statement #% is %', v_statement.number, v_statement.status; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount above zero'; end if;
  select coalesce(sum(i.total_cents - coalesce(p.paid, 0)), 0) into v_balance
  from public.sub_invoices i
  left join (select invoice_id, sum(amount_cents) as paid from public.sub_payments where voided_at is null group by invoice_id) p
    on p.invoice_id = i.id
  where i.statement_id = v_statement.id and i.status = 'open';
  if p_amount_cents > v_balance then
    raise exception 'that is more than the % still owed', to_char(v_balance / 100.0, 'FM$999,999,990.00');
  end if;

  for v_invoice in
    select i.id, i.total_cents - coalesce((select sum(amount_cents) from public.sub_payments where invoice_id = i.id and voided_at is null), 0) as owed
    from public.sub_invoices i
    where i.statement_id = v_statement.id and i.status = 'open'
    order by i.number
    for update of i
  loop
    exit when v_left <= 0;
    v_part := least(v_left, v_invoice.owed);
    if v_part > 0 then
      insert into public.sub_payments (company_id, invoice_id, amount_cents, method, reference, received_on, created_by)
      values (v_company, v_invoice.id, v_part, p_method, nullif(trim(coalesce(p_reference, '')), ''),
              coalesce(p_received_on, app.company_today(v_company)), auth.uid());
      if v_part = v_invoice.owed then update public.sub_invoices set status = 'paid' where id = v_invoice.id; end if;
      v_left := v_left - v_part;
    end if;
  end loop;
  perform app.sync_sub_statement(v_statement.id);
  perform app.emit(v_company, 'sub_statement', v_statement.id, 'sub_statement_payment_recorded',
    jsonb_build_object('amount_cents', p_amount_cents, 'number', v_statement.number));
end;
$$;

-- Owner: take back a statement that went out wrong. Its invoices go back to
-- waiting, so the jobs can be reopened and fixed and a new statement issued.
create function public.void_sub_statement(p_statement_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_statement public.sub_statements;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  select * into v_statement from public.sub_statements where id = p_statement_id and company_id = v_company for update;
  if v_statement.id is null then raise exception 'statement not found' using errcode = 'P0002'; end if;
  if v_statement.status = 'void' then raise exception 'statement #% is already void', v_statement.number; end if;
  if exists (
    select 1 from public.sub_payments p join public.sub_invoices i on i.id = p.invoice_id
    where i.statement_id = v_statement.id and p.voided_at is null
  ) then
    raise exception 'statement #% has a payment on it; void the payment first', v_statement.number;
  end if;
  update public.sub_statements set status = 'void', void_reason = trim(p_reason) where id = v_statement.id;
  update public.sub_invoices set statement_id = null where statement_id = v_statement.id;
  perform app.emit(v_company, 'sub_statement', v_statement.id, 'sub_statement_voided',
    jsonb_build_object('reason', trim(p_reason), 'number', v_statement.number));
end;
$$;

-- Closing a job: no invoice email for a contractor billed weekly ---------------------------

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

  -- Invoice per job: held 15 minutes so a wrong number can be fixed (reopening
  -- voids the invoice, and the delivery skips a void one). Billed weekly: it
  -- waits for the contractor's statement instead.
  if v_gc.billing = 'per_job' and nullif(trim(coalesce(v_gc.billing_email, '')), '') is not null then
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

-- Reopening a job whose invoice is on a statement would leave the statement
-- billing a void invoice: void the statement first.
create or replace function public.reopen_sub_job(p_job_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_job public.sub_jobs := app.staff_sub_job(p_job_id);
  v_invoice public.sub_invoices;
  v_statement_number int;
begin
  if v_job.status <> 'done' then raise exception 'only a closed job can be reopened'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  select * into v_invoice from public.sub_invoices where job_id = v_job.id and status <> 'void' for update;
  if v_invoice.status = 'paid' or exists (
    select 1 from public.sub_payments where invoice_id = v_invoice.id and voided_at is null
  ) then
    raise exception 'invoice #% has a payment on it; void the payment first', v_invoice.number;
  end if;
  select number into v_statement_number from public.sub_statements where id = v_invoice.statement_id and status <> 'void';
  if v_statement_number is not null then
    raise exception 'invoice #% is on statement #%; void the statement first', v_invoice.number, v_statement_number;
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

-- Payments on a single invoice keep its statement's status in step.
create or replace function public.record_sub_payment(
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
  if v_invoice.statement_id is not null then perform app.sync_sub_statement(v_invoice.statement_id); end if;
  perform app.emit(v_company, 'sub_job', v_invoice.job_id, 'sub_payment_recorded',
    jsonb_build_object('amount_cents', p_amount_cents, 'invoice_number', v_invoice.number));
  return v_id;
end;
$$;

create or replace function public.void_sub_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_payment public.sub_payments;
  v_statement uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  select * into v_payment from public.sub_payments
  where id = p_payment_id and company_id = v_company and voided_at is null for update;
  if v_payment.id is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  update public.sub_payments set voided_at = now(), void_reason = trim(p_reason) where id = v_payment.id;
  update public.sub_invoices set status = 'open' where id = v_payment.invoice_id and status = 'paid'
  returning statement_id into v_statement;
  if v_statement is null then select statement_id into v_statement from public.sub_invoices where id = v_payment.invoice_id; end if;
  if v_statement is not null then perform app.sync_sub_statement(v_statement); end if;
end;
$$;

-- Grants ------------------------------------------------------------------------------------

revoke execute on function
  app.sync_sub_statement(uuid), app.issue_sub_statement(uuid, uuid, date, uuid)
from public, anon, authenticated;
grant execute on function
  app.sync_sub_statement(uuid), app.issue_sub_statement(uuid, uuid, date, uuid)
to service_role;

revoke execute on function
  public.issue_sub_statement(uuid, date),
  public.record_sub_statement_payment(uuid, int, text, text, date),
  public.void_sub_statement(uuid, text)
from public, anon;
grant execute on function
  public.issue_sub_statement(uuid, date),
  public.record_sub_statement_payment(uuid, int, text, text, date),
  public.void_sub_statement(uuid, text)
to authenticated, service_role;

-- The cron's: one company at a time, with the service role.
revoke execute on function public.issue_sub_statements(uuid) from public, anon, authenticated;
grant execute on function public.issue_sub_statements(uuid) to service_role;
