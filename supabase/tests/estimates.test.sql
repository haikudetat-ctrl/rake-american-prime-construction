-- Price list, measurements, proposals: who can see costs, who can change prices.
begin;
\ir support/fixtures.sql
select plan(17);

select id as company from public.companies where slug = 'american-prime' \gset
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.create_lead('Pat', '+16095550100', null, '12 Ocean Ave', 'replacement', null, 'office') as lead \gset
reset role;

-- First price list, seeded by the server
select tests.act_as_service();
select public.seed_catalog(:'company', '{"materials":[],"systems":[],"labor":{}}') as catalog1 \gset
select is(public.seed_catalog(:'company', '{"materials":[],"systems":[],"labor":{}}'), :'catalog1'::uuid, 'seeding twice keeps one');
reset role;

-- Who sees the price list
select tests.act_as('00000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.catalog_versions), 0, 'office cannot read supplier costs');
select throws_ok($$ select public.publish_catalog('{"materials":[],"systems":[],"labor":{}}', false) $$, '42501', null,
  'office cannot publish prices');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.catalog_versions), 1, 'owner reads the price list');
select public.publish_catalog('{"materials":[],"systems":[],"labor":{}}', false) as catalog2 \gset
select throws_ok($$ select public.publish_catalog('[]', false) $$, 'P0001', 'that is not a price list', 'junk is refused');
reset role;
select is((select count(*)::int from public.catalog_versions where is_active), 1, 'one active version');
select is((select version from public.catalog_versions where is_active), 2, 'new version is active');

-- Measurements
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.save_measurement(:'lead', 'manual', null, '{"squares": 30, "pitch": 8, "eaves": 150, "deck_sheets": 4}', null) as m1 \gset
reset role;
select is((select squares from public.measurements where id = :'m1'), 30.00::numeric, 'squares saved');
select is((select layers from public.measurements where id = :'m1'), 1, 'defaults filled in');

-- Proposals: saved by the server only
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.save_proposal(%L, %L, %L, null, %L, null, '{}', '{}', '[{"systemId":"x","priceCents":1}]', '[]', '[]', '{}') $$,
  :'company', '00000000-0000-0000-0000-000000000002', :'lead', :'catalog2'), '42501', null, 'office cannot write its own prices');
reset role;
select tests.act_as_service();
select public.save_proposal(:'company', '00000000-0000-0000-0000-000000000002', :'lead', null, :'catalog2', :'m1',
  '{"squares":30}', '{}', '[{"systemId":"gaf-good","priceCents":1500000},{"systemId":"gaf-best","priceCents":2100000}]',
  '[]', '[]', '{"options":[{"systemId":"gaf-good","costCents":1050000}]}') as p1 \gset
reset role;

select tests.act_as('00000000-0000-0000-0000-000000000002');
select is((select jsonb_array_length(options) from public.proposals where id = :'p1'), 2, 'office sees the options and prices');
select is((select count(*)::int from public.proposal_costs), 0, 'office cannot see the cost build-up');
select throws_ok(format($$ select public.override_option_price(%L, 'gaf-good', 1450000, 'deal') $$, :'p1'), '42501', null,
  'office cannot change a price');
reset role;

select tests.act_as('00000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.proposal_costs), 1, 'owner sees the build-up');
select throws_ok(format($$ select public.override_option_price(%L, 'gaf-good', 1450000, '') $$, :'p1'), 'P0001',
  'say why the price is different', 'an override needs a reason');
select public.override_option_price(:'p1', 'gaf-good', 1450000, 'Neighbor discount');
reset role;
select is((select (options -> 0 ->> 'overrideCents')::int from public.proposals where id = :'p1'), 1450000, 'override stored on the option');
select is((select options -> 1 ->> 'overrideCents' from public.proposals where id = :'p1'), null, 'other options untouched');

select * from finish();
rollback;
