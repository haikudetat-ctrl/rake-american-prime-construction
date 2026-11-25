-- Quick invoices: typed or price-list lines, the database's totals, the shared
-- number sequence, issue with a held email, payments, voids, and who sees them.
begin;
\ir support/fixtures.sql
select plan(41);

select id as company from public.companies where slug = 'american-prime' \gset
select id as roofing from public.brands where company_id = :'company' and kind = 'roofing' \gset
select id as dumpster from public.brands where company_id = :'company' and kind = 'dumpster' \gset
select id as other_brand_company from public.companies where slug = 'other-co' \gset
insert into public.brands (company_id, kind, display_name) values (:'other_brand_company', 'roofing', 'Other Roofing') returning id as other_brand \gset
insert into public.dumpster_price_items (company_id, description, unit, unit_cents) values (:'company', 'Mattress', 'each', 5000) returning id as mattress \gset
insert into public.sub_contractors (company_id, name, billing_email, cents_per_sq, payment_terms_days)
values (:'company', 'Example GC', 'ap@gc.example', 10000, 30) returning id as gc \gset
insert into public.sub_price_items (company_id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents)
values (:'company', :'gc', '5" K-style gutter', 'ft', 550, 200) returning id as gutter \gset
select app.company_today(:'company') as today \gset
select app.next_number(:'company', 'invoice') as before_number \gset

-- Drafting -------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.save_quick_invoice(null, jsonb_build_object(
  'brand_id', :'roofing',
  'bill_to', jsonb_build_object('name', '  Pat Example ', 'email', 'PAT@Example.com', 'phone', '+15550001111', 'address', '1 Example Road'),
  'contractor_id', :'gc',
  'due_on', (:'today'::date + 15)::text,
  'tax_pct', '6.625',
  'lines', jsonb_build_array(
    jsonb_build_object('description', 'Chimney repair', 'quantity', 1, 'unit_cents', 45000, 'source', 'custom'),
    jsonb_build_object('description', '5" K-style gutter', 'quantity', 120, 'unit', 'ft', 'unit_cents', 600, 'source', 'sub_price', 'source_item_id', :'gutter'),
    jsonb_build_object('description', 'Mattress', 'quantity', 2, 'unit', 'each', 'unit_cents', 5000, 'source', 'dumpster_price', 'source_item_id', :'mattress'),
    jsonb_build_object('description', 'Returning customer credit', 'quantity', 1, 'unit_cents', -5000)
  )
)) as inv \gset
reset role;

select is((select status from public.quick_invoices where id = :'inv'), 'draft', 'a quick invoice starts as a draft');
select is((select number from public.quick_invoices where id = :'inv'), :before_number + 1, 'it takes the next number from the shared invoice sequence');
select is((select subtotal_cents from public.quick_invoices where id = :'inv'), 45000 + 72000 + 10000 - 5000, 'subtotal is the database''s sum of qty x price, credits included');
select is((select tax_cents from public.quick_invoices where id = :'inv'), 8083, 'sales tax is rounded to the cent: 6.625% of $1,220.00');
select is((select total_cents from public.quick_invoices where id = :'inv'), 130083, 'total is subtotal plus tax');
select is((select bill_to_name from public.quick_invoices where id = :'inv'), 'Pat Example', 'the bill-to name is trimmed');
select is((select bill_to_email from public.quick_invoices where id = :'inv'), 'pat@example.com', 'the email is stored lower case');
select is((select array_agg(position order by position) from public.quick_invoice_lines where invoice_id = :'inv'), array[1, 2, 3, 4], 'lines keep their order');
select is((select unit_cents from public.quick_invoice_lines where invoice_id = :'inv' and position = 2), 600, 'a price list item''s price can be changed on the invoice');
select is((select source_item_id from public.quick_invoice_lines where invoice_id = :'inv' and position = 2), :'gutter'::uuid, 'and it remembers which item it came from');
select is((select count(*)::int from public.outbox_messages where kind = 'quick_invoice_issued'), 0, 'saving a draft emails nothing');

-- Refusals -------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{}'::jsonb, 'due_on', :'today', 'lines', '[{"description":"x","quantity":1,"unit_cents":100}]'::jsonb)),
  'P0001', 'enter who the invoice is for', 'a bill-to name is required');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"A"}'::jsonb, 'due_on', :'today', 'lines', '[]'::jsonb)),
  'P0001', 'add at least one line', 'an invoice needs a line');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'other_brand', 'bill_to', '{"name":"A"}'::jsonb, 'due_on', :'today', 'lines', '[{"description":"x","quantity":1,"unit_cents":100}]'::jsonb)),
  'P0002', 'pick the brand it goes out under', 'another company''s brand is refused');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"A"}'::jsonb, 'due_on', :'today', 'lines', '[{"description":"x","quantity":1,"unit_cents":-100}]'::jsonb)),
  'P0001', 'credits can''t take the invoice below zero', 'a negative total is refused');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"A"}'::jsonb, 'due_on', :'today', 'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', 1, 'unit_cents', 100, 'source', 'sub_price', 'source_item_id', gen_random_uuid())))),
  'P0002', 'line 1: that price list item is gone; pick it again or make it a custom item', 'a price list item must exist');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"A","email":"not-an-email"}'::jsonb, 'due_on', :'today', 'lines', '[{"description":"x","quantity":1,"unit_cents":100}]'::jsonb)),
  'P0001', 'that email doesn''t look right', 'a bad email is refused');
select throws_ok($$ insert into public.quick_invoices (company_id, brand_id, number, bill_to_name, due_on) values (app.current_company_id(), (select id from public.brands limit 1), 1, 'x', current_date) $$,
  '42501', null, 'nobody inserts a quick invoice directly');
reset role;

-- Editing the draft: lines are replaced, the number stays ---------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.save_quick_invoice(:'inv', jsonb_build_object(
  'brand_id', :'dumpster', 'bill_to', jsonb_build_object('name', 'Pat Example', 'email', 'pat@example.com'),
  'due_on', (:'today'::date - 3)::text,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Chimney repair', 'quantity', 1.5, 'unit_cents', 33333))
));
reset role;
select is((select number from public.quick_invoices where id = :'inv'), :before_number + 1, 'editing a draft keeps its number');
select is((select count(*)::int from public.quick_invoice_lines where invoice_id = :'inv'), 1, 'editing replaces the lines');
select is((select total_cents from public.quick_invoices where id = :'inv'), 50000, '1.5 x $333.33 rounds to $500.00, with no tax');
select is((select brand_id from public.quick_invoices where id = :'inv'), :'dumpster'::uuid, 'the brand can change on a draft');

-- Issuing ----------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.issue_quick_invoice(:'inv', 'pat@example.com');
select throws_ok(format($$ select public.save_quick_invoice(%L, %L) $$, :'inv', jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"A"}'::jsonb, 'due_on', :'today', 'lines', '[{"description":"x","quantity":1,"unit_cents":100}]'::jsonb)),
  'P0001', format('invoice #%s is already issued; void it and make a new one to change it', :before_number + 1), 'an issued invoice can''t be edited');
select throws_ok(format($$ select public.issue_quick_invoice(%L) $$, :'inv'), 'P0001', format('invoice #%s is already open', :before_number + 1), 'issuing twice is refused');
reset role;
select is((select status from public.quick_invoices where id = :'inv'), 'open', 'issuing opens it');
select is((select issued_on from public.quick_invoices where id = :'inv'), :'today'::date, 'it is issued today');
select is((select due_on from public.quick_invoices where id = :'inv'), :'today'::date, 'a due date in the past moves up to today');
select is((select count(*)::int from public.outbox_messages where kind = 'quick_invoice_issued' and payload ->> 'invoice_id' = :'inv'
  and payload ->> 'to' = 'pat@example.com' and run_after > now() + interval '14 minutes'), 1, 'the email is queued and held 15 minutes');
select is((select email_queued_to from public.quick_invoices where id = :'inv'), 'pat@example.com', 'the invoice shows where its email is going');

-- Payments ---------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.record_quick_payment(%L, 60000, 'check', null, null) $$, :'inv'), 'P0001',
  'that is more than the $500.00 still owed', 'a payment can''t exceed the balance');
select public.record_quick_payment(:'inv', 20000, 'check', '1001', null) as p1 \gset
select public.record_quick_payment(:'inv', 30000, 'ach', null, null) as p2 \gset
reset role;
select is((select status from public.quick_invoices where id = :'inv'), 'paid', 'paid in full marks it paid');
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.void_quick_invoice(%L, 'typo') $$, :'inv'), 'P0001',
  format('invoice #%s has a payment recorded; void the payment first', :before_number + 1), 'a paid invoice can''t be voided');
select public.void_quick_payment(:'p2', 'bounced');
reset role;
select is((select status from public.quick_invoices where id = :'inv'), 'open', 'voiding a payment reopens it');

-- Voiding ------------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.void_quick_payment(:'p1', 'entered on the wrong invoice');
select throws_ok(format($$ select public.void_quick_invoice(%L, 'typo') $$, :'inv'), '42501',
  'only an owner can void an issued invoice', 'the office can''t void an issued invoice');
select public.save_quick_invoice(null, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"Scrap"}'::jsonb, 'due_on', :'today',
  'lines', '[{"description":"x","quantity":1,"unit_cents":100}]'::jsonb)) as scrap \gset
select public.void_quick_invoice(:'scrap', 'Discarded draft');
reset role;
select is((select status from public.quick_invoices where id = :'scrap'), 'void', 'the office can discard a draft');
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.void_quick_invoice(:'inv', 'Wrong customer');
reset role;
select is((select status from public.quick_invoices where id = :'inv'), 'void', 'an owner can void an issued invoice with no payments');

-- Other billing is untouched -----------------------------------------------------------------------
select is((select count(*)::int from public.invoices), 0, 'no dumpster invoice was made, so no statement can pick it up');
select is((select count(*)::int from public.sub_invoices), 0, 'no contractor invoice or crew pay was made');

-- Who sees them -------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.quick_invoices), 0, 'drivers see no quick invoices');
select throws_ok(format($$ select public.save_quick_invoice(null, %L) $$, jsonb_build_object('brand_id', :'roofing', 'bill_to', '{"name":"A"}'::jsonb, 'due_on', :'today', 'lines', '[{"description":"x","quantity":1,"unit_cents":100}]'::jsonb)),
  '42501', 'not authorized', 'drivers can''t make one');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.quick_invoices), 0, 'another company sees none of them');
reset role;

select * from finish();
rollback;
