-- Aftercare: Mark final, feedback gate, review link, referrals and rewards.
begin;
\ir support/fixtures.sql
select plan(25);

select id as company from public.companies where slug = 'american-prime' \gset
select id as brand from public.brands where company_id = :'company' and kind = 'roofing' \gset
insert into public.catalog_versions (id, company_id, version, data, needs_confirmation, is_active)
values ('00000000-0000-0000-0000-0000000000f0', :'company', 1, '{}', false, true);

-- Helper: a lead with a signed proposal and a job of the given total.
create function tests.make_job(p_n int, p_phone text, p_total int) returns uuid language plpgsql as $$
declare v_lead uuid; v_prop uuid; v_job uuid; v_company uuid; v_brand uuid;
begin
  select id into v_company from public.companies where slug = 'american-prime';
  select id into v_brand from public.brands where company_id = v_company and kind = 'roofing';
  insert into public.leads (company_id, brand_id, source, name, phone, email) values (v_company, v_brand, 'office', 'Customer ' || p_n, p_phone, 'c' || p_n || '@example.com') returning id into v_lead;
  insert into public.proposals (company_id, lead_id, number, catalog_version_id, needs_confirmation, measurement, inputs, options, addons, public_token, status)
  values (v_company, v_lead, 7000 + p_n, '00000000-0000-0000-0000-0000000000f0', false, '{}', '{}', '[]', '[]', repeat(p_n::text, 40), 'signed') returning id into v_prop;
  insert into public.roofing_jobs (company_id, lead_id, proposal_id, customer_name, customer_phone, system_name, scope, total_cents)
  values (v_company, v_lead, v_prop, 'Customer ' || p_n, p_phone, 'GAF Timberline HDZ', '{}', p_total) returning id into v_job;
  return v_job;
end $$;

select tests.make_job(1, '+16095550101', 1500000) as job1 \gset
select tests.make_job(2, '+16095550102', 1200000) as job2 \gset

-- Mark final ---------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.mark_job_final(%L) $$, :'job1'), 'P0001', 'the crew has to mark the job done first',
  'cannot finalize before the crew is done');
select public.set_roofing_job_status(:'job1', 'done');
select lives_ok(format($$ select public.mark_job_final(%L) $$, :'job1'), 'owner marks it final');
select throws_ok(format($$ select public.mark_job_final(%L) $$, :'job1'), 'P0001', 'this job is already final', 'only once');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.set_roofing_job_status(:'job2', 'done');
select throws_ok(format($$ select public.mark_job_final(%L) $$, :'job2'), '42501', null, 'office cannot mark final');
reset role;

select is((select count(*)::int from public.outbox_messages where kind = 'aftercare_warranty'), 2, 'warranty by text and email');
select ok((select run_after > now() + interval '23 hours' from public.outbox_messages where kind = 'feedback_request'),
  'feedback request waits a day');
select token as token1, referral_code as code1 from public.aftercare where job_id = :'job1' \gset
select matches(:'code1'::text, '^[2-9A-HJKMNP-Z]{8}$', 'referral code is 8 unambiguous characters');

-- Feedback -----------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.submit_feedback(%L, 'great', null) $$, :'token1'), '42501', null,
  'feedback is recorded by the server only');
reset role;
select tests.act_as_service();
select is(public.record_review_click(:'token1'), null, 'no review link before a great rating');
select is(public.submit_feedback(:'token1', 'great', 'Crew was great'), 'great', 'great rating recorded');
select is(public.submit_feedback(:'token1', 'poor', 'changed mind'), 'great', 'the first answer stands');
reset role;
select ok((select run_after > now() + interval '2 days' from public.outbox_messages where kind = 'referral_invite'),
  'referral link follows a few days later');
select is((select count(*)::int from public.outbox_messages where kind = 'feedback_followup'), 0, 'no follow-up for great');

-- Google link comes from settings.
insert into public.review_settings (company_id, google_review_url, reward_cents) values (:'company', 'https://g.page/r/example/review', 15000);
select tests.act_as_service();
select is(public.record_review_click(:'token1'), 'https://g.page/r/example/review', 'great → review link, click logged');
reset role;

-- A poor rating goes to the office, not to Google.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.mark_job_final(:'job2');
reset role;
select token as token2 from public.aftercare where job_id = :'job2' \gset
select tests.act_as_service();
select public.submit_feedback(:'token2', 'poor', 'Nails in the driveway');
select is(public.record_review_click(:'token2'), null, 'no review link after a poor rating');
reset role;
select is((select follow_up from public.aftercare where job_id = :'job2'), 'open', 'follow-up opened');
select is((select count(*)::int from public.outbox_messages where kind = 'feedback_followup'), 1, 'owner texted about it');

-- Referrals ----------------------------------------------------------------------------
select tests.act_as_service();
select public.submit_referral_lead(lower(:'code1'), 'Friend One', '+16095550199', null, '5 Bay Rd', null, null, null, null,
  'replacement', null, null, 'h1') as friend_lead \gset
reset role;
select is((select source from public.leads where id = :'friend_lead'), 'referral', 'friend comes in as a referral lead');
select is((select reward_cents from public.referrals where lead_id = :'friend_lead'), 15000, 'reward amount from settings');

-- The friend signs and pays; reward earned only when paid in full.
insert into public.proposals (id, company_id, lead_id, number, catalog_version_id, needs_confirmation, measurement, inputs, options, addons, status)
values ('00000000-0000-0000-0000-0000000000f9', :'company', :'friend_lead', 7999, '00000000-0000-0000-0000-0000000000f0', false, '{}', '{}', '[]', '[]', 'signed');
insert into public.roofing_jobs (id, company_id, lead_id, proposal_id, customer_name, system_name, scope, total_cents)
values ('00000000-0000-0000-0000-0000000000fa', :'company', :'friend_lead', '00000000-0000-0000-0000-0000000000f9', 'Friend One', 'HDZ', '{}', 1000000);
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_job_payment('00000000-0000-0000-0000-0000000000fa', 400000, 'check', null, null);
reset role;
select is((select status from public.referrals where lead_id = :'friend_lead'), 'pending', 'deposit alone earns nothing');
select tests.act_as('00000000-0000-0000-0000-000000000002');
select public.record_job_payment('00000000-0000-0000-0000-0000000000fa', 600000, 'ach', null, null);
reset role;
select is((select status from public.referrals where lead_id = :'friend_lead'), 'earned', 'paid in full → reward earned');
select is((select count(*)::int from public.outbox_messages where kind in ('referral_earned', 'reward_owed')), 2,
  'referrer thanked, owner told the reward is owed');

select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.mark_reward_paid(id, 'gift_card', 'x') from public.referrals where lead_id = %L $$, :'friend_lead'),
  '42501', null, 'only the owner pays rewards');
reset role;
select tests.act_as('00000000-0000-0000-0000-000000000001');
select public.mark_reward_paid(id, 'gift_card', 'Amazon card #123') from public.referrals where lead_id = :'friend_lead';
select is((public.review_numbers(current_date - 30) ->> 'rewards_owed_cents')::int, 0, 'nothing owed once paid');
reset role;
select is((select status from public.referrals where lead_id = :'friend_lead'), 'paid', 'reward paid and recorded');

select * from finish();
rollback;
