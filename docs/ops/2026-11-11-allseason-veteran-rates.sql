-- Run once, right after 20261112143433_sub_pitch_tiers_minimum_price_list.
-- Applied to production 2026-11-12, right after that migration.
-- American Prime's live rates from the Nov 11 onboarding call and Andrey's
-- Roofing & Repair Price Worksheet. Safe to re-run: every statement checks
-- what is there first.

-- All Season: +$15 a square at 9-10/12, +$20 at 11-12/12, $1,400 minimum a roof.
-- On the call Andrey entered a $15 step from 9/12, which the migration converts
-- to a tier at every pitch (+$30 at 10/12, +$60 at 12/12). Replace exactly that.
update public.sub_contractors
set pitch_tiers = '[{"from": 9, "cents": 1500}, {"from": 11, "cents": 2000}]'::jsonb,
    min_job_cents = coalesce(min_job_cents, 140000)
where name = 'ALL SEASON' and cents_per_sq = 12000 and pitch_tiers = app.linear_pitch_tiers(9, 1500);

-- Gutter price lists. Crew pay is what Andrey said on the call: $1 a foot less
-- than the contractor pays, $3 less a miter (a miter runs about 3 ft).
-- Roofing extras (plywood, extra layers, skylights...) wait until he confirms
-- what the crew gets for them.
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
select c.company_id, c.id, v.description, v.unit, v.bill, v.pay
from public.sub_contractors c
cross join (values
  ('5" K-style gutter', 'ft', 550, 450),
  ('6" K-style gutter', 'ft', 650, 550),
  ('5" gutter guard', 'ft', 550, 450),
  ('6" gutter guard', 'ft', 650, 550),
  ('5" miter', 'each', 1650, 1350),
  ('6" miter', 'each', 1800, 1500),
  ('2x3 downspout', 'ft', 550, 450),
  ('Downspout for 6" gutters', 'ft', 650, 550)
) as v(description, unit, bill, pay)
where c.name = 'ALL SEASON'
on conflict (contractor_id, description) do nothing;

insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
select c.company_id, c.id, v.description, v.unit, v.bill, v.pay
from public.sub_contractors c
cross join (values
  ('5" K-style gutter', 'ft', 650, 550),
  ('6" K-style gutter', 'ft', 750, 650),
  ('5" downspout', 'ft', 650, 550),
  ('6" downspout', 'ft', 750, 650)
) as v(description, unit, bill, pay)
where c.name = 'Veteran Roofing'
on conflict (contractor_id, description) do nothing;
