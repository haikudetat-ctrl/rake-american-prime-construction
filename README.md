# Rake for American Prime

Operations system for American Prime Construction. Phase 1 runs the dumpster
business: customer request link → office approval → driver run → scale ticket →
weekly statement → payment.

Design: [docs/design.md](docs/design.md). Phase 2 (roofing): [docs/phase-2-design.md](docs/phase-2-design.md).

## Stack

Next.js 16, React 19, Supabase (Postgres 17, Auth, Storage), Tailwind v4, zod,
vitest, pgTAP. Deployed on Vercel with two crons (`vercel.json`).

Supabase project: `rake-american-prime-construction` (`jfonoearbpcqsofkmqvr`, us-east-1).

## Layout

```
app/request/[slug]   public dumpster request link (no login)
app/roof/[slug]      public roofing estimate link (no login), with past-job photos
app/office           owner/office: today, requests, leads, inbox (texts, calls), jobs (P&L), stock, cans, customers, billing, numbers, settings
app/driver           driver run, English/Spanish
app/crew             roofing crew jobs, English/Spanish (no prices)
app/p/[token]        homeowner proposal: review, choose, sign; signed PDF
app/login            email link (office) and text code (drivers)
app/api/cron         outbox delivery (5 min) and daily reminders + Monday statements
app/api/twilio       business phone webhooks (calls, voicemail, texts), signature-checked
lib/                 pure logic (money, dates, dispatch, turnaround, messages) + integrations
supabase/migrations  schema, RLS and workflow functions — billing math lives here
supabase/tests       pgTAP: RLS by role, full rental lifecycle, outbox
```

Every workflow step (drop, pickup, scale ticket, statement, payment) is a
Postgres function, so the can, the invoice and the outbound message change in
one transaction. The app reads with the signed-in user's client; RLS decides
what each role sees. Drivers have no access to any table that carries prices.

## Checks

```bash
npm ci
npm run lint && npm run typecheck && npm test   # app
npm run db:test                                 # pgTAP against a throwaway local Postgres 16
```

`db:test` needs `postgresql-16` and `postgresql-16-pgtap`; it applies the
migrations on top of a small Supabase stand-in (`supabase/tests/support`). With
Docker available, `supabase test db` runs the same suites.

## Going live — one-time setup

1. **Vercel:** create the project from this repo; set the variables in
   `.env.example`.
2. **Supabase Auth → URL configuration:** Site URL = `APP_URL`; add
   `APP_URL/auth/callback` to redirect URLs. Disable "Allow new users to sign up".
3. **Supabase Auth → Phone:** enable, provider Twilio Verify (drivers' sign-in codes).
4. **First owner:** create the user in Supabase Auth (email), then run:
   ```sql
   insert into public.profiles (user_id, full_name, phone)
   select id, 'Andrey', '+1XXXXXXXXXX' from auth.users where email = 'owner@example.com';
   insert into public.memberships (user_id, company_id, role)
   select u.id, c.id, 'owner' from auth.users u, public.companies c
   where u.email = 'owner@example.com' and c.slug = 'american-prime';
   ```
   Everyone else is added from **Settings → Team**.
5. **Settings:** paste real proposal terms (attorney-reviewed) and fill the roofing price list
   (then tick "these are real prices"); enable "Maps Static API" on the Google key for proposal
   photos; add past-job photos for the roofing page (`/roof/roof`); publish real prices (clears the placeholder banner), add yard
   and landfill addresses, cans, and the business phone/mailing address that
   print on statements.
6. **Business phone:** set `TWILIO_AUTH_TOKEN`; in Settings → Business phone add the ring list and
   hours, then point the number's voice webhook and the Messaging Service's incoming webhook at the
   URLs shown there.
7. **Twilio:** register the business number for A2P 10DLC before texts go to
   customers; carrier approval takes weeks.
