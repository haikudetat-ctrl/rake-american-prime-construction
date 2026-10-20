-- Phase 3a: job costing, bulk stock, roofing payments, and the cash view.
--
-- Every roofing job gets its own profit and loss: what the customer pays
-- against crew pay, supplier bills, stock pulled from the shelf (at the
-- average price paid), our own dumpster and gutters at real cost, permits and
-- anything else. Nothing is deleted: a wrong entry is voided, so the history
-- stays readable.
--
-- Owner and office read and write through the functions below. Crews never
-- see any of it.

create table public.cost_settings (
  company_id uuid primary key references public.companies(id),
  -- From the Oct 12 call: about $250 a dumpster, about $2.50 a foot for gutters.
  own_dumpster_cents int not null default 25000 check (own_dumpster_cents >= 0),
  own_gutter_cents_per_ft int not null default 250 check (own_gutter_cents_per_ft >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.cost_settings enable row level security;
revoke all on public.cost_settings from anon, authenticated;
grant all on public.cost_settings to service_role;

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  unit text not null default 'each',
  on_hand numeric(12, 2) not null default 0,
  -- Running average of what was paid per unit, in cents (fractions kept).
  avg_cost_cents numeric(14, 4) not null default 0 check (avg_cost_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  item_id uuid not null references public.stock_items(id),
  kind text not null check (kind in ('buy', 'pull', 'return', 'count')),
  qty numeric(12, 2) not null, -- signed change to on-hand
  unit_cost_cents numeric(14, 4) not null default 0,
  total_cents int not null default 0, -- cash paid (buy) or charged to the job (pull/return)
  job_id uuid references public.roofing_jobs(id),
  vendor text,
  reference text,
  note text,
  moved_on date not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index stock_moves_item_idx on public.stock_moves(item_id, created_at desc);

create table public.job_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_id uuid not null references public.roofing_jobs(id),
  kind text not null check (kind in ('crew', 'materials', 'stock', 'dumpster', 'gutters', 'permit', 'other')),
  description text not null,
  qty numeric(12, 2),
  unit_cents numeric(14, 4),
  amount_cents int not null,
  vendor text,
  reference text,
  incurred_on date not null,
  stock_move_id uuid references public.stock_moves(id),
  -- Cash leaves the business for crew, supplier bills, permits, other. Stock
  -- pulls (paid when bought) and our own equipment do not.
  is_cash boolean not null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index job_costs_job_idx on public.job_costs(job_id) where voided_at is null;
create index job_costs_cash_idx on public.job_costs(company_id, incurred_on) where voided_at is null and is_cash;

create table public.job_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_id uuid not null references public.roofing_jobs(id),
  amount_cents int not null check (amount_cents > 0),
  method text not null check (method in ('check', 'ach', 'card', 'cash', 'financing', 'other')),
  reference text,
  received_on date not null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index job_payments_job_idx on public.job_payments(job_id) where voided_at is null;

create trigger stock_items_audit after insert or update on public.stock_items for each row execute function app.audit();
create trigger job_costs_audit after insert or update on public.job_costs for each row execute function app.audit();
create trigger job_payments_audit after insert or update on public.job_payments for each row execute function app.audit();

alter table public.stock_items enable row level security;
alter table public.stock_moves enable row level security;
alter table public.job_costs enable row level security;
alter table public.job_payments enable row level security;
revoke all on public.stock_items, public.stock_moves, public.job_costs, public.job_payments from anon, authenticated;
grant select on public.stock_items, public.stock_moves, public.job_costs, public.job_payments to authenticated;
grant all on public.stock_items, public.stock_moves, public.job_costs, public.job_payments to service_role;
create policy stock_items_staff_read on public.stock_items for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy stock_moves_staff_read on public.stock_moves for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy job_costs_staff_read on public.job_costs for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy job_payments_staff_read on public.job_payments for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());

-- Helpers ---------------------------------------------------------------------------

create function app.staff_job(p_job_id uuid) returns public.roofing_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs;
begin
  select * into v_job from public.roofing_jobs where id = p_job_id and company_id = app.require_staff();
  if v_job.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  return v_job;
end;
$$;

-- Job costs ----------------------------------------------------------------------------

create function public.add_job_cost(
  p_job_id uuid, p_kind text, p_description text, p_amount_cents int,
  p_qty numeric, p_unit_cents numeric, p_vendor text, p_reference text, p_incurred_on date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs := app.staff_job(p_job_id);
  v_id uuid;
begin
  if p_kind not in ('crew', 'materials', 'permit', 'other') then
    raise exception 'use the stock and own-equipment buttons for those';
  end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then raise exception 'describe the cost'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount above zero'; end if;
  insert into public.job_costs (company_id, job_id, kind, description, qty, unit_cents, amount_cents, vendor,
                                reference, incurred_on, is_cash, created_by)
  values (v_job.company_id, v_job.id, p_kind, trim(p_description), p_qty, p_unit_cents, p_amount_cents,
          nullif(trim(coalesce(p_vendor, '')), ''), nullif(trim(coalesce(p_reference, '')), ''),
          coalesce(p_incurred_on, app.company_today(v_job.company_id)), true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Our own dumpster or gutters, charged at what they really cost us.
create function public.add_own_equipment(p_job_id uuid, p_kind text, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs := app.staff_job(p_job_id);
  v_dumpster int;
  v_gutter int;
  v_id uuid;
begin
  select coalesce(own_dumpster_cents, 25000), coalesce(own_gutter_cents_per_ft, 250) into v_dumpster, v_gutter
  from public.cost_settings where company_id = v_job.company_id;
  v_dumpster := coalesce(v_dumpster, 25000);
  v_gutter := coalesce(v_gutter, 250);
  if p_qty is null or p_qty <= 0 then raise exception 'enter how many'; end if;
  if p_kind = 'dumpster' then
    insert into public.job_costs (company_id, job_id, kind, description, qty, unit_cents, amount_cents, incurred_on, is_cash, created_by)
    values (v_job.company_id, v_job.id, 'dumpster', 'Our dumpster', p_qty, v_dumpster, round(p_qty * v_dumpster),
            app.company_today(v_job.company_id), false, auth.uid())
    returning id into v_id;
  elsif p_kind = 'gutters' then
    insert into public.job_costs (company_id, job_id, kind, description, qty, unit_cents, amount_cents, incurred_on, is_cash, created_by)
    values (v_job.company_id, v_job.id, 'gutters', 'Our gutters (ft)', p_qty, v_gutter, round(p_qty * v_gutter),
            app.company_today(v_job.company_id), false, auth.uid())
    returning id into v_id;
  else
    raise exception 'unknown equipment';
  end if;
  return v_id;
end;
$$;

-- Voiding a stock pull puts the stock back on the shelf.
create function public.void_job_cost(p_cost_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_cost public.job_costs;
  v_move public.stock_moves;
begin
  select * into v_cost from public.job_costs where id = p_cost_id and company_id = v_company for update;
  if v_cost.id is null then raise exception 'cost not found' using errcode = 'P0002'; end if;
  if v_cost.voided_at is not null then raise exception 'already voided'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  update public.job_costs set voided_at = now(), void_reason = trim(p_reason) where id = v_cost.id;
  if v_cost.stock_move_id is not null then
    select * into v_move from public.stock_moves where id = v_cost.stock_move_id;
    update public.stock_items set on_hand = on_hand - v_move.qty where id = v_move.item_id;
    insert into public.stock_moves (company_id, item_id, kind, qty, unit_cost_cents, total_cents, job_id, note, moved_on, created_by)
    values (v_company, v_move.item_id, case when v_move.qty < 0 then 'return' else 'pull' end, -v_move.qty,
            v_move.unit_cost_cents, -v_move.total_cents, v_move.job_id, 'Voided: ' || trim(p_reason),
            app.company_today(v_company), auth.uid());
  end if;
end;
$$;

-- Stock ------------------------------------------------------------------------------

create function public.create_stock_item(p_name text, p_unit text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_id uuid;
begin
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'name the item'; end if;
  insert into public.stock_items (company_id, name, unit)
  values (v_company, trim(p_name), coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'each'))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'there is already an item called %', trim(p_name);
end;
$$;

-- A bulk buy: adds quantity and re-averages the cost per unit.
create function public.stock_buy(p_item_id uuid, p_qty numeric, p_total_cents int, p_vendor text, p_reference text, p_bought_on date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_item public.stock_items;
  v_base numeric;
begin
  select * into v_item from public.stock_items where id = p_item_id and company_id = v_company for update;
  if v_item.id is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'enter how many you bought'; end if;
  if p_total_cents is null or p_total_cents < 0 then raise exception 'enter what you paid'; end if;
  v_base := greatest(v_item.on_hand, 0);
  update public.stock_items set
    avg_cost_cents = (v_base * v_item.avg_cost_cents + p_total_cents) / (v_base + p_qty),
    on_hand = on_hand + p_qty
  where id = v_item.id;
  insert into public.stock_moves (company_id, item_id, kind, qty, unit_cost_cents, total_cents, vendor, reference, moved_on, created_by)
  values (v_company, v_item.id, 'buy', p_qty, p_total_cents::numeric / p_qty, p_total_cents,
          nullif(trim(coalesce(p_vendor, '')), ''), nullif(trim(coalesce(p_reference, '')), ''),
          coalesce(p_bought_on, app.company_today(v_company)), auth.uid());
end;
$$;

-- Pull from the shelf for a job (positive) or return unused stock (negative),
-- at the current average cost.
create function public.stock_pull(p_item_id uuid, p_job_id uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs := app.staff_job(p_job_id);
  v_item public.stock_items;
  v_amount int;
  v_move uuid;
  v_cost uuid;
begin
  select * into v_item from public.stock_items where id = p_item_id and company_id = v_job.company_id for update;
  if v_item.id is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'enter how many'; end if;
  if p_qty > v_item.on_hand then
    raise exception 'only % % on hand; record the buy or fix the count first', v_item.on_hand, v_item.unit;
  end if;
  v_amount := round(p_qty * v_item.avg_cost_cents);
  update public.stock_items set on_hand = on_hand - p_qty where id = v_item.id;
  insert into public.stock_moves (company_id, item_id, kind, qty, unit_cost_cents, total_cents, job_id, moved_on, created_by)
  values (v_job.company_id, v_item.id, case when p_qty > 0 then 'pull' else 'return' end, -p_qty, v_item.avg_cost_cents,
          v_amount, v_job.id, app.company_today(v_job.company_id), auth.uid())
  returning id into v_move;
  insert into public.job_costs (company_id, job_id, kind, description, qty, unit_cents, amount_cents, incurred_on,
                                stock_move_id, is_cash, created_by)
  values (v_job.company_id, v_job.id, 'stock',
          case when p_qty > 0 then v_item.name else v_item.name || ' (returned)' end,
          p_qty, v_item.avg_cost_cents, v_amount, app.company_today(v_job.company_id), v_move, false, auth.uid())
  returning id into v_cost;
  return v_cost;
end;
$$;

-- Set the count to what's actually on the shelf.
create function public.stock_count(p_item_id uuid, p_on_hand numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_item public.stock_items;
begin
  select * into v_item from public.stock_items where id = p_item_id and company_id = v_company for update;
  if v_item.id is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if p_on_hand is null or p_on_hand < 0 then raise exception 'enter the count'; end if;
  update public.stock_items set on_hand = p_on_hand where id = v_item.id;
  insert into public.stock_moves (company_id, item_id, kind, qty, unit_cost_cents, note, moved_on, created_by)
  values (v_company, v_item.id, 'count', p_on_hand - v_item.on_hand, v_item.avg_cost_cents,
          nullif(trim(coalesce(p_note, '')), ''), app.company_today(v_company), auth.uid());
end;
$$;

-- Payments ---------------------------------------------------------------------------

create function public.record_job_payment(p_job_id uuid, p_amount_cents int, p_method text, p_reference text, p_received_on date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.roofing_jobs := app.staff_job(p_job_id);
  v_id uuid;
  v_paid int;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'enter an amount above zero'; end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.job_payments where job_id = v_job.id and voided_at is null;
  if v_paid + p_amount_cents > v_job.total_cents then
    raise exception 'that is more than the % still owed', to_char((v_job.total_cents - v_paid) / 100.0, 'FM$999,999,990.00');
  end if;
  insert into public.job_payments (company_id, job_id, amount_cents, method, reference, received_on, created_by)
  values (v_job.company_id, v_job.id, p_amount_cents, p_method, nullif(trim(coalesce(p_reference, '')), ''),
          coalesce(p_received_on, app.company_today(v_job.company_id)), auth.uid())
  returning id into v_id;
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_job.company_id, v_job.lead_id, 'note',
          format('Payment received: %s (%s)%s', to_char(p_amount_cents / 100.0, 'FM$999,999,990.00'), p_method,
                 case when v_paid + p_amount_cents = v_job.total_cents then ' — paid in full' else '' end),
          auth.uid());
  perform app.emit(v_job.company_id, 'roofing_job', v_job.id, 'job_payment_recorded',
    jsonb_build_object('amount_cents', p_amount_cents, 'paid_in_full', v_paid + p_amount_cents = v_job.total_cents));
  return v_id;
end;
$$;

create function public.void_job_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'say why'; end if;
  update public.job_payments set voided_at = now(), void_reason = trim(p_reason)
  where id = p_payment_id and company_id = v_company and voided_at is null;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
end;
$$;

-- Cash view ----------------------------------------------------------------------------

-- Weeks starting Monday: cash out (crew, bills, permits, other, stock buys)
-- and cash in (roofing and dumpster payments).
create function public.cash_weeks(p_from date, p_weeks int)
returns table (week_start date, cash_out_cents bigint, cash_in_cents bigint)
language sql stable security definer set search_path = '' as $$
  with company as (select app.require_staff() as id),
  weeks as (
    select (date_trunc('week', p_from::timestamp) + make_interval(weeks => n))::date as week_start
    from generate_series(0, least(greatest(p_weeks, 1), 52) - 1) as n
  )
  select w.week_start,
    coalesce((select sum(c.amount_cents) from public.job_costs c, company
              where c.company_id = company.id and c.is_cash and c.voided_at is null
                and c.incurred_on >= w.week_start and c.incurred_on < w.week_start + 7), 0)
    + coalesce((select sum(m.total_cents) from public.stock_moves m, company
                where m.company_id = company.id and m.kind = 'buy'
                  and m.moved_on >= w.week_start and m.moved_on < w.week_start + 7), 0),
    coalesce((select sum(p.amount_cents) from public.job_payments p, company
              where p.company_id = company.id and p.voided_at is null
                and p.received_on >= w.week_start and p.received_on < w.week_start + 7), 0)
    + coalesce((select sum(p.amount_cents) from public.payments p, company
                where p.company_id = company.id
                  and p.received_on >= w.week_start and p.received_on < w.week_start + 7), 0)
  from weeks w
  order by w.week_start
$$;

-- Money owed to the business right now.
create function public.money_owed()
returns table (roofing_cents bigint, dumpster_cents bigint)
language sql stable security definer set search_path = '' as $$
  with company as (select app.require_staff() as id)
  select
    coalesce((select sum(j.total_cents - coalesce((select sum(p.amount_cents) from public.job_payments p
                                                   where p.job_id = j.id and p.voided_at is null), 0))
              from public.roofing_jobs j, company where j.company_id = company.id), 0)::bigint,
    coalesce((select sum(s.total_cents - coalesce((select sum(p.amount_cents) from public.payments p
                                                   where p.statement_id = s.id), 0))
              from public.statements s, company where s.company_id = company.id and s.status = 'open'), 0)::bigint
$$;

-- Grants -----------------------------------------------------------------------------

revoke execute on function app.staff_job(uuid) from public, anon;
grant execute on function app.staff_job(uuid) to authenticated, service_role;

revoke execute on function
  public.add_job_cost(uuid, text, text, int, numeric, numeric, text, text, date),
  public.add_own_equipment(uuid, text, numeric),
  public.void_job_cost(uuid, text),
  public.create_stock_item(text, text),
  public.stock_buy(uuid, numeric, int, text, text, date),
  public.stock_pull(uuid, uuid, numeric),
  public.stock_count(uuid, numeric, text),
  public.record_job_payment(uuid, int, text, text, date),
  public.void_job_payment(uuid, text),
  public.cash_weeks(date, int),
  public.money_owed()
from public, anon;
grant execute on function
  public.add_job_cost(uuid, text, text, int, numeric, numeric, text, text, date),
  public.add_own_equipment(uuid, text, numeric),
  public.void_job_cost(uuid, text),
  public.create_stock_item(text, text),
  public.stock_buy(uuid, numeric, int, text, text, date),
  public.stock_pull(uuid, uuid, numeric),
  public.stock_count(uuid, numeric, text),
  public.record_job_payment(uuid, int, text, text, date),
  public.void_job_payment(uuid, text),
  public.cash_weeks(date, int),
  public.money_owed()
to authenticated, service_role;
