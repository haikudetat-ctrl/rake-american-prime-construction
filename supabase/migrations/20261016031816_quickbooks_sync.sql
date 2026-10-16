-- Slice 3: QuickBooks sync.
--
-- What goes to QuickBooks: an invoice, once it is on an issued statement (so
-- it can no longer change in Rake), with its customer created or linked first.
-- What comes back: payments, read from each QuickBooks invoice's balance and
-- recorded against the Rake statement.
--
-- Which QuickBooks product/service each kind of line posts to is per-company
-- configuration (qbo_settings), chosen by an owner after the accountant decides.

create table public.qbo_settings (
  company_id uuid primary key references public.companies(id),
  sync_enabled boolean not null default false,
  item_delivery text,
  item_extended_days text,
  item_tonnage text,
  item_adjustment text,
  -- A run claims the company by setting run_started_at, so the cron and a
  -- "Sync now" click never push the same invoice twice at once. A claim older
  -- than ten minutes is treated as a crashed run.
  run_started_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.qbo_settings enable row level security;
revoke all on public.qbo_settings from anon, authenticated;
grant all on public.qbo_settings to service_role;

-- Per-invoice sync state. qbo_synced_hash is a digest of what was last sent,
-- so a statement voided and re-issued with changes updates the QuickBooks
-- invoice instead of leaving it stale.
alter table public.invoices
  add column qbo_sync_token text,
  add column qbo_synced_hash text,
  add column qbo_synced_at timestamptz,
  add column qbo_voided_at timestamptz,
  add column qbo_sync_error text,
  add column qbo_paid_cents int not null default 0;

create index invoices_qbo_pending_idx on public.invoices(company_id)
  where status in ('on_statement', 'paid', 'void');

-- Records what QuickBooks says has been paid on a statement's invoices.
-- Called by the sync job (service role) with the statement's QuickBooks-paid
-- total so far; it records only the increase since the last call, so running
-- the sync repeatedly never double-counts.
create function public.record_qbo_payments(p_statement_id uuid, p_qbo_paid_total_cents int, p_reference text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_statement public.statements;
  v_recorded int;
  v_new int;
  v_paid int;
begin
  select * into v_statement from public.statements where id = p_statement_id for update;
  if v_statement.id is null then raise exception 'statement not found'; end if;
  if v_statement.status <> 'open' then return 0; end if;

  select coalesce(sum(amount_cents), 0) into v_recorded
  from public.payments where statement_id = v_statement.id and method = 'qbo';
  v_new := p_qbo_paid_total_cents - v_recorded;
  if v_new <= 0 then return 0; end if;

  insert into public.payments (company_id, customer_id, statement_id, amount_cents, method, reference, received_on)
  values (v_statement.company_id, v_statement.customer_id, v_statement.id, v_new, 'qbo',
          nullif(p_reference, ''), app.company_today(v_statement.company_id));

  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where statement_id = v_statement.id;
  if v_paid >= v_statement.total_cents then
    update public.statements set status = 'paid' where id = v_statement.id;
    update public.invoices set status = 'paid' where statement_id = v_statement.id;
  end if;
  perform app.emit(v_statement.company_id, 'statement', v_statement.id, 'qbo_payment_recorded',
    jsonb_build_object('amount_cents', v_new));
  return v_new;
end;
$$;

revoke execute on function public.record_qbo_payments(uuid, int, text) from public, anon, authenticated;
grant execute on function public.record_qbo_payments(uuid, int, text) to service_role;
