-- The Google review link works after any answer, not only after a "great" one.
-- Google's Business Profile policy lists selectively soliciting positive reviews as
-- rating manipulation (reviews removed, account suspension possible). The owner
-- follow-up for "okay" and "poor" answers is unchanged; it lives in submit_feedback.
create or replace function public.record_review_click(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_care public.aftercare;
begin
  update public.aftercare set review_clicked_at = coalesce(review_clicked_at, now())
  where token = p_token and rating is not null
  returning * into v_care;
  if v_care.job_id is null then return null; end if;
  return (app.review_setting(v_care.company_id)).google_review_url;
end;
$$;
