-- American Prime Construction: the one company this deployment serves.
-- Both brands start as "American Prime" until the DBA names are chosen.
-- The price book is a placeholder (needs_confirmation) until Andrey confirms
-- the delivery fee ($250 and $350 were both heard on the call) and the
-- extended-rental charge.

do $$
declare
  v_company uuid;
  v_dumpster uuid;
begin
  insert into public.companies (slug, name) values ('american-prime', 'American Prime Construction')
  returning id into v_company;

  insert into public.brands (company_id, kind, display_name)
  values (v_company, 'roofing', 'American Prime Construction');
  insert into public.brands (company_id, kind, display_name)
  values (v_company, 'dumpster', 'American Prime Construction')
  returning id into v_dumpster;

  insert into public.yards (company_id, name) values
    (v_company, 'Home yard'),
    (v_company, 'Atlantic City yard');

  insert into public.price_books (
    company_id, version, delivery_fee_cents, extended_after_days,
    extended_fee_cents_per_day, needs_confirmation
  ) values (v_company, 1, 35000, 7, 0, true);

  insert into public.request_links (company_id, brand_id, slug)
  values (v_company, v_dumpster, 'dumpster');
end;
$$;
