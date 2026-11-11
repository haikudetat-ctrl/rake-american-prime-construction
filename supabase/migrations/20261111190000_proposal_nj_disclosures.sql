-- What a New Jersey home improvement contract must state beyond the owner's
-- own terms: the legal name, the liability insurer and its phone number, and
-- when the work starts and finishes. The address, phone and HIC number are
-- already in settings. The app appends these facts and the three-day
-- cancellation notice to the terms when a proposal is sent (lib/proposals/
-- disclosures.ts), and refuses to send until they are all filled in.
alter table public.proposal_settings
  add column legal_name text,
  add column insurer_name text,
  add column insurer_phone text,
  add column start_within_days int check (start_within_days between 1 and 365),
  add column finish_within_days int check (finish_within_days between 1 and 365);
