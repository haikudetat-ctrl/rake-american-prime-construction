-- Roofing leads by email (Nov 23).
--
-- request_emails gave dumpster requests an email to every owner and office
-- login. Roofing leads were left on texts alone, and those only reach staff
-- with a phone on their profile: the office login has none, so a website or
-- referral lead reached nobody unless someone had Rake open.
--
-- Now a new lead also goes by email, from the roofing brand, to every active
-- owner and office login at the address they sign in with. The texts stay as
-- they were. Called by submit_lead_request and submit_referral_lead; both are
-- unchanged.

create or replace function app.lead_staff_notify(p_lead public.leads) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_staff record;
  v_email record;
begin
  for v_staff in
    select p.phone, p.locale from public.memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.company_id = p_lead.company_id and m.is_active
      and m.role in ('owner', 'office') and p.phone is not null
  loop
    perform app.enqueue(
      p_lead.company_id, 'sms', 'lead_received',
      jsonb_build_object(
        'to', v_staff.phone, 'locale', v_staff.locale, 'lead_id', p_lead.id,
        'name', p_lead.name, 'need', p_lead.need, 'address', p_lead.address, 'source', p_lead.source
      ),
      'lead:' || p_lead.id || ':notify:' || v_staff.phone
    );
  end loop;

  for v_email in
    select u.email, p.locale from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.company_id = p_lead.company_id and m.is_active
      and m.role in ('owner', 'office') and nullif(trim(u.email), '') is not null
  loop
    perform app.enqueue(
      p_lead.company_id, 'email', 'lead_received',
      jsonb_build_object(
        'to', v_email.email, 'locale', coalesce(v_email.locale, 'en'), 'lead_id', p_lead.id,
        'name', p_lead.name, 'need', p_lead.need, 'source', p_lead.source,
        'phone', p_lead.phone, 'email', p_lead.email, 'address', p_lead.address, 'notes', p_lead.notes
      ),
      'lead:' || p_lead.id || ':notify:' || lower(v_email.email)
    );
  end loop;
end;
$$;

revoke execute on function app.lead_staff_notify(public.leads) from public, anon, authenticated;
grant execute on function app.lead_staff_notify(public.leads) to service_role;
