-- Phase 2c: roof measurements, the roofing price list, and draft proposals.
--
-- The price list (catalog) is one JSON document per published version, owner
-- only: it carries supplier costs and the margin. Proposals snapshot what they
-- were priced from (measurements, choices, catalog version), so a later price
-- change never reprices one already built. The cost build-up behind each price
-- is in proposal_costs, which only owners can read; office sees prices.
--
-- Pricing itself runs in the app (lib/estimate/price.ts, unit-tested); a
-- proposal is saved only by the server (service role) after it re-prices from
-- the stored catalog, so nobody can post their own numbers.

create table public.catalog_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  version int not null,
  data jsonb not null,
  needs_confirmation boolean not null default true,
  is_active boolean not null default false,
  published_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, version)
);
create unique index catalog_versions_one_active on public.catalog_versions(company_id) where is_active;
create trigger catalog_versions_audit after insert or update on public.catalog_versions for each row execute function app.audit();

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id),
  source text not null check (source in ('roofr', 'manual')),
  report_path text,
  squares numeric(8, 2) not null check (squares >= 0),
  pitch numeric(4, 1) not null default 6 check (pitch between 0 and 30),
  stories int not null default 1 check (stories between 1 and 5),
  layers int not null default 1 check (layers between 0 and 5),
  eaves numeric(8, 2) not null default 0 check (eaves >= 0),
  rakes numeric(8, 2) not null default 0 check (rakes >= 0),
  ridges numeric(8, 2) not null default 0 check (ridges >= 0),
  hips numeric(8, 2) not null default 0 check (hips >= 0),
  valleys numeric(8, 2) not null default 0 check (valleys >= 0),
  step_flashing numeric(8, 2) not null default 0 check (step_flashing >= 0),
  wall_flashing numeric(8, 2) not null default 0 check (wall_flashing >= 0),
  skylights int not null default 0 check (skylights >= 0),
  pipe_boots int not null default 0 check (pipe_boots >= 0),
  vents int not null default 0 check (vents >= 0),
  chimneys int not null default 0 check (chimneys >= 0),
  deck_sheets int not null default 0 check (deck_sheets >= 0),
  -- What the report reader found, kept for checking the reader against reality.
  parsed jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index measurements_lead_idx on public.measurements(lead_id, created_at desc);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  lead_id uuid not null references public.leads(id),
  number int not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  catalog_version_id uuid not null references public.catalog_versions(id),
  needs_confirmation boolean not null,
  measurement_id uuid references public.measurements(id),
  measurement jsonb not null,
  inputs jsonb not null,
  -- [{systemId, name, brand, tier, tierLabel, warranty, priceCents, overrideCents?}]
  options jsonb not null,
  -- [{addonId, name, qty, unitLabel, priceCents}]
  addons jsonb not null,
  warnings jsonb not null default '[]',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index proposals_lead_idx on public.proposals(lead_id, created_at desc);
create trigger proposals_touch before update on public.proposals for each row execute function app.touch_updated_at();
create trigger proposals_audit after insert or update on public.proposals for each row execute function app.audit();

create table public.proposal_costs (
  proposal_id uuid primary key references public.proposals(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  -- [{systemId, costCents, marginPct, lines: [...]}, …] and add-on costs
  breakdown jsonb not null
);

alter table public.catalog_versions enable row level security;
alter table public.measurements enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_costs enable row level security;
revoke all on public.catalog_versions, public.measurements, public.proposals, public.proposal_costs from anon, authenticated;
grant select on public.catalog_versions, public.measurements, public.proposals, public.proposal_costs to authenticated;
grant all on public.catalog_versions, public.measurements, public.proposals, public.proposal_costs to service_role;

create policy catalog_versions_owner_read on public.catalog_versions for select to authenticated
  using (app.is_owner() and company_id = app.current_company_id());
create policy measurements_staff_read on public.measurements for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy proposals_staff_read on public.proposals for select to authenticated
  using (app.is_staff() and company_id = app.current_company_id());
create policy proposal_costs_owner_read on public.proposal_costs for select to authenticated
  using (app.is_owner() and company_id = app.current_company_id());

-- Private bucket for uploaded measurement reports. Guarded for the test harness.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('roof-reports', 'roof-reports', false, 26214400, array['application/pdf'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Workflow -------------------------------------------------------------------------

-- Owner publishes a new price list version; the previous one stays for the
-- proposals priced from it. The app validates the document's shape first.
create function public.publish_catalog(p_data jsonb, p_needs_confirmation boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_id uuid;
begin
  if jsonb_typeof(p_data) <> 'object' or not (p_data ? 'materials' and p_data ? 'systems' and p_data ? 'labor') then
    raise exception 'that is not a price list';
  end if;
  perform 1 from public.companies where id = v_company for update; -- one publish at a time
  update public.catalog_versions set is_active = false where company_id = v_company and is_active;
  insert into public.catalog_versions (company_id, version, data, needs_confirmation, is_active, published_by)
  values (v_company, coalesce((select max(version) from public.catalog_versions where company_id = v_company), 0) + 1,
          p_data, p_needs_confirmation, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The first price list, published by the server from the app's placeholder
-- when a company has none yet.
create function public.seed_catalog(p_company_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.catalog_versions where company_id = p_company_id and is_active;
  if v_id is not null then return v_id; end if;
  perform 1 from public.companies where id = p_company_id for update;
  select id into v_id from public.catalog_versions where company_id = p_company_id and is_active;
  if v_id is not null then return v_id; end if;
  insert into public.catalog_versions (company_id, version, data, needs_confirmation, is_active)
  values (p_company_id, 1, p_data, true, true)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.save_measurement(
  p_lead_id uuid,
  p_source text,
  p_report_path text,
  p_values jsonb,
  p_parsed jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_staff();
  v_id uuid;
begin
  if not exists (select 1 from public.leads where id = p_lead_id and company_id = v_company) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  insert into public.measurements (
    company_id, lead_id, source, report_path, squares, pitch, stories, layers,
    eaves, rakes, ridges, hips, valleys, step_flashing, wall_flashing,
    skylights, pipe_boots, vents, chimneys, deck_sheets, parsed, created_by
  ) values (
    v_company, p_lead_id, p_source, p_report_path,
    coalesce((p_values ->> 'squares')::numeric, 0), coalesce((p_values ->> 'pitch')::numeric, 6),
    coalesce((p_values ->> 'stories')::int, 1), coalesce((p_values ->> 'layers')::int, 1),
    coalesce((p_values ->> 'eaves')::numeric, 0), coalesce((p_values ->> 'rakes')::numeric, 0),
    coalesce((p_values ->> 'ridges')::numeric, 0), coalesce((p_values ->> 'hips')::numeric, 0),
    coalesce((p_values ->> 'valleys')::numeric, 0), coalesce((p_values ->> 'step_flashing')::numeric, 0),
    coalesce((p_values ->> 'wall_flashing')::numeric, 0),
    coalesce((p_values ->> 'skylights')::int, 0), coalesce((p_values ->> 'pipe_boots')::int, 0),
    coalesce((p_values ->> 'vents')::int, 0), coalesce((p_values ->> 'chimneys')::int, 0),
    coalesce((p_values ->> 'deck_sheets')::int, 0), p_parsed, auth.uid()
  ) returning id into v_id;
  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_company, p_lead_id, 'note',
          format('Measurements %s: %s squares, %s/12', case when p_source = 'roofr' then 'from Roofr report' else 'entered' end,
                 coalesce(p_values ->> 'squares', '0'), coalesce(p_values ->> 'pitch', '6')),
          auth.uid());
  return v_id;
end;
$$;

-- Server only: store a priced proposal (new, or a re-price of a draft). The
-- caller has already checked the actor is staff of this company.
create function public.save_proposal(
  p_company_id uuid,
  p_actor uuid,
  p_lead_id uuid,
  p_proposal_id uuid,
  p_catalog_version_id uuid,
  p_measurement_id uuid,
  p_measurement jsonb,
  p_inputs jsonb,
  p_options jsonb,
  p_addons jsonb,
  p_warnings jsonb,
  p_costs jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_catalog public.catalog_versions;
  v_id uuid := p_proposal_id;
begin
  if not exists (select 1 from public.leads where id = p_lead_id and company_id = p_company_id) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  select * into v_catalog from public.catalog_versions where id = p_catalog_version_id and company_id = p_company_id;
  if v_catalog.id is null then raise exception 'price list not found'; end if;
  if jsonb_array_length(p_options) = 0 then raise exception 'choose at least one roof system'; end if;

  if v_id is null then
    insert into public.proposals (
      company_id, lead_id, number, catalog_version_id, needs_confirmation, measurement_id,
      measurement, inputs, options, addons, warnings, created_by
    ) values (
      p_company_id, p_lead_id, app.next_number(p_company_id, 'proposal'), v_catalog.id, v_catalog.needs_confirmation,
      p_measurement_id, p_measurement, p_inputs, p_options, p_addons, p_warnings, p_actor
    ) returning id into v_id;
    insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
    values (p_company_id, p_lead_id, 'note', 'Estimate drafted', p_actor);
  else
    update public.proposals set
      catalog_version_id = v_catalog.id, needs_confirmation = v_catalog.needs_confirmation,
      measurement_id = p_measurement_id, measurement = p_measurement, inputs = p_inputs,
      options = p_options, addons = p_addons, warnings = p_warnings
    where id = v_id and company_id = p_company_id and lead_id = p_lead_id and status = 'draft';
    if not found then raise exception 'only a draft can be changed; make a new version instead'; end if;
  end if;

  insert into public.proposal_costs (proposal_id, company_id, breakdown)
  values (v_id, p_company_id, p_costs)
  on conflict (proposal_id) do update set breakdown = excluded.breakdown;
  return v_id;
end;
$$;

-- Owner sets a different price on one option of a draft (rounding, a deal).
-- Logged on the lead so the reason is on record. Null clears the override.
create function public.override_option_price(p_proposal_id uuid, p_system_id text, p_price_cents int, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app.require_owner();
  v_proposal public.proposals;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id and company_id = v_company for update;
  if v_proposal.id is null then raise exception 'proposal not found' using errcode = 'P0002'; end if;
  if v_proposal.status <> 'draft' then raise exception 'only a draft can be changed'; end if;
  if p_price_cents is not null and p_price_cents <= 0 then raise exception 'enter a price above zero'; end if;
  if p_price_cents is not null and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why the price is different';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_proposal.options) o where o ->> 'systemId' = p_system_id) then
    raise exception 'that option is not on this proposal';
  end if;

  update public.proposals set options = (
    select jsonb_agg(
      case when o ->> 'systemId' = p_system_id
        then case when p_price_cents is null then o - 'overrideCents' - 'overrideReason'
                  else o || jsonb_build_object('overrideCents', p_price_cents, 'overrideReason', trim(p_reason)) end
        else o end
      order by ord)
    from jsonb_array_elements(v_proposal.options) with ordinality as e(o, ord)
  ) where id = v_proposal.id;

  insert into public.lead_events (company_id, lead_id, kind, body, actor_id)
  values (v_company, v_proposal.lead_id, 'note',
          case when p_price_cents is null then format('Proposal #%s: price override removed', v_proposal.number)
               else format('Proposal #%s: price set to $%s — %s', v_proposal.number,
                           to_char(p_price_cents / 100.0, 'FM999,999,990.00'), trim(p_reason)) end,
          auth.uid());
end;
$$;

-- Grants -----------------------------------------------------------------------------

revoke execute on function
  public.publish_catalog(jsonb, boolean),
  public.seed_catalog(uuid, jsonb),
  public.save_measurement(uuid, text, text, jsonb, jsonb),
  public.save_proposal(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.override_option_price(uuid, text, int, text)
from public, anon;
revoke execute on function
  public.seed_catalog(uuid, jsonb),
  public.save_proposal(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
from authenticated;
grant execute on function
  public.publish_catalog(jsonb, boolean),
  public.save_measurement(uuid, text, text, jsonb, jsonb),
  public.override_option_price(uuid, text, int, text)
to authenticated;
grant execute on function
  public.publish_catalog(jsonb, boolean),
  public.seed_catalog(uuid, jsonb),
  public.save_measurement(uuid, text, text, jsonb, jsonb),
  public.save_proposal(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.override_option_price(uuid, text, int, text)
to service_role;
