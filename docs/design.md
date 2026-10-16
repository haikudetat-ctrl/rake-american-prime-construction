# Rake for American Prime — System Design

**Date:** 2026-10-14
**Status:** Phase 1 foundation built (branch `claude/phase-1-dumpster-ops`); schema live on Supabase
**Client:** American Prime Construction (Andrey Fallas) — roofing and dumpster rental, South/Central NJ
**Owner:** Chris Boland / 2Stack
**Sources:** Discovery call, 2026-10-12 (Fathom); *American Prime Systems Plan* (Claude Docs, 2026-10-12)

---

## 1. What this system is for

American Prime runs two businesses out of one phone and one calendar. The dumpster
side takes ~90% of the owner's time: rentals are scheduled in a personal calendar,
only the owner knows the run, and invoices go out when he finds time (the last batch
was 15 cans for one customer, ~4 weeks late). The roofing side sells well from
referrals but has no job-level profit visibility and pays crews before customers pay.

The strategic goal is to move from subcontract labor to selling American Prime's own
roofing jobs. The dumpster system comes first because it is the fastest way to give
the owner his days back.

### Facts from discovery (to confirm — see §9)

| Item | Value heard |
|---|---|
| Rentals | ~10/week now; goal 20/week within 6 months |
| Cans | 9 |
| Yards | Home yard + rented yard in Atlantic City (~50% of rentals are south) |
| Trucks | New non-CDL truck (anyone can drive); old CDL truck, limited use |
| Customers | Roofing companies, mostly ones American Prime also subcontracts for |
| Pricing | Delivery fee ($250 or $350 — both heard) + tonnage passed through at cost |
| Extended rental | Charged after 7 days |
| Invoicing today | Spreadsheet/PDF → recently QuickBooks; no card payments set up |
| Roofing tools | Roofr (~$200/mo) for measurements + proposals; likes RoofSnap sketches |
| Manufacturers | GAF certified; Owens Corning in progress |

## 2. Phases

| Phase | Scope | Status |
|---|---|---|
| 1. Dumpster operations | Can tracker, request link, approval, driver app (EN/ES), scale tickets, invoices, weekly statements, reminders, weekly numbers | **This build** |
| 2. Roofing front door | Business number + texting, homeowner intake link, phone proposals (good/better/best, satellite cover, e-sign), owner/crew views | Later |
| 3. Job costing, reviews, referrals | Per-job P&L, bulk-stock costing, cash view, review-then-referral flow, payouts | Later |

**Deferred deliberately:** automatic route optimization (sort-by-area is enough at
3–4 stops/day), customer logins for booking (the request link covers it), automatic
late fees (owner's call per customer), our own payment processing (QuickBooks
payment links; no Stripe), paid ads (after Phase 3).

## 3. Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Deployment | Own repo, own Supabase project, own Vercel project | PIW is NJ-hard-coded and tenant-pinned per deployment; Rake's GTM plan calls for per-tenant deployment; keeps American Prime's data (crew pay, financials) out of All Season's database |
| Stack | Next.js 16, React 19, Supabase (Postgres 17, Auth, Storage), Tailwind v4, zod, vitest, pgTAP | Same as PIW / roof-quote / referral app, so code and people move between them |
| Background work | Postgres outbox + job queue (`SKIP LOCKED`), drained by Vercel Cron | Proven in roof-quote; no Inngest dependency for this volume |
| Email | Resend | Already used across 2Stack projects |
| SMS + driver sign-in | Twilio (Messaging + Verify) | PIW `src/modules/sms` and `TWILIO_VERIFY_*` already in use |
| Addresses | Google Places autocomplete + geocode | PIW / roof-quote `lib/geo` |
| PDFs | `@react-pdf/renderer` | roof-quote `lib/pdf` |
| Accounting | Our own invoice ledger now; QuickBooks Online sync behind a connector, off until Intuit app approval + accountant sign-off | Billing works on day one regardless of Intuit's timeline |
| Payments before QuickBooks | Statements say "pay by check or ACH"; office records payments manually | No Stripe; QuickBooks payment links replace this when the sync turns on |

### Reuse map

| Source | What we take | Phase |
|---|---|---|
| PIW `company_memberships`, `has_company_role()` | Role model and RLS helpers | 1 |
| Referral app `automation.domain_events` / outbox | Event log + outbox shape | 1 |
| roof-quote `lib/jobs/queue.ts` | Postgres job queue drained by cron | 1 |
| PIW `src/modules/sms` | Twilio send, inbound, consent | 1–2 |
| roof-quote `lib/pdf`, `lib/geo/static-map.ts` | Statement PDF; proposal PDF + satellite cover | 1–2 |
| roof-quote "a quote never reads live config" | Versioned price book, snapshotted per rental | 1 |
| PIW `roof_pricing_tiers`, `proposals` module | Good/better/best pricing | 2 |
| Referral app feedback/review/payout designs | Review-before-referral, gift card / ACH payouts | 3 |

Code is copied and adapted, not shared as a package. Extract a shared package only
once a third deployment needs the same module.

## 4. Data model

All tables carry `company_id` and have RLS enabled. Every write records the acting
user. Money is stored as integer cents.

### Core (all phases)

- `companies` — the tenant (American Prime Construction).
- `brands` — DBAs under the company (`roofing`, `dumpster`). Both start as
  "American Prime"; renaming a brand never moves data. Customer-facing documents
  render from the brand.
- `profiles` — name, phone, `locale` (`en` | `es`).
- `memberships` — `user_id`, `company_id`, `role`:
  - `owner` — everything (Andrey, his wife).
  - `office` — everything except settings and user management.
  - `driver` — own assigned stops only; no prices, invoices, or customer billing.
  - `crew` — reserved for Phase 2 roofing jobs.
- `domain_events`, `outbox_messages`, `delivery_attempts` — append-only events and
  reliable side effects (SMS, email, reminders, QuickBooks sync).
- `audit_log` — who changed what.

### Dumpster (Phase 1)

- `yards` — name, address, geocode. Seed: home yard, Atlantic City.
- `landfills` — name, address, accepted material.
- `cans` — label, size (yards³), home yard, status (`available`, `on_site`,
  `in_transit`, `out_of_service`).
- `price_books` — versioned: delivery fee, extended threshold (days), extended
  charge, tonnage policy (pass-through at cost). Never edited in place.
- `customers` — roofing companies: name, billing email, terms, `brand_id`.
- `customer_contacts` — people who order.
- `sites` — job addresses, geocoded, linked to a customer.
- `rental_requests` — submissions from the request link: contact, company,
  address, requested date, size, notes, status (`pending`, `approved`, `declined`),
  spam/rate-limit metadata.
- `rentals` — the unit of work: customer, site, can, `price_book_id` (snapshot),
  status (`scheduled` → `on_site` → `pickup_requested` → `picked_up` → `dumped` →
  `closed`), `dropped_at`, `picked_up_at`, days-out (derived).
- `stops` — the driver's run: `rental_id`, kind (`drop`, `pickup`, `dump`),
  scheduled date, assigned driver, sequence, status, completed_at. A pickup
  creates the dump stop. (A swap is a pickup plus a new rental's drop.)
- `scale_tickets` — rental, landfill, tons, fee (cents), photo (Storage path),
  entered_by.
- `invoices` — one per rental: status (`draft` → `final` → `on_statement` →
  `paid` | `void`), `qbo_id` (nullable).
- `invoice_lines` — `delivery`, `extended_days`, `tonnage`, `adjustment`.
- `statements` — one per customer per week; due date; sent_at. The PDF is
  rendered from the rows when needed, never stored.
- `payments` — amount, method (`check`, `ach`, `cash`, `qbo`, `other`), applied
  to a statement.
- Reminders are outbox messages with a per-statement dedupe key, so the daily
  cron can run any number of times without sending twice.

Phase 2/3 tables (`leads`, `properties`, `proposals`, `jobs`, `job_costs`,
`stock_items`, `referrals`, …) are added when those phases start; the core above is
built so they attach to `companies`, `brands`, and `memberships` without change.

## 5. Phase 1 flows

### Booking
1. Customer opens the request link (`/request/[slug]`, no login), picks an address
   (Places autocomplete), date, size, and notes.
2. A `rental_requests` row is created; owners/office get an SMS + in-app alert.
3. Office approves (creates `customer`/`site` if new, a `rental`, and a `drop`
   stop) or declines/reschedules. Customer gets a confirmation email/SMS.

### Driver run
1. Driver signs in with a text-message code.
2. `/driver` shows today's stops grouped by area (yard → town), in order.
3. Driver taps **Dropped** / **Picked up**; at the landfill, photographs the scale
   ticket and enters tons and fee.
4. Interface is English or Spanish per the driver's profile, with a toggle.

### Billing
1. **Drop** → draft invoice with the delivery line (price from the rental's
   price-book snapshot).
2. **Pickup** → if days out > threshold, add the extended line.
3. **Scale ticket** → add the tonnage line at cost → invoice `final`.
4. **Monday** → one statement per customer covering all final invoices; PDF emailed
   via Resend. Payment instructions: check or ACH (QuickBooks link once synced).
5. **Reminders** at 3 and 5 days past due. No automatic late fees.
6. **QuickBooks connector** (off by default; built in slice 3): pushes each invoice
   on an issued statement to QBO (creating or linking the customer), voids what is
   voided here, and pulls payments back from QBO invoice balances. Which QBO
   product/service each line kind posts to is an owner setting, pending the
   accountant. Our ledger stays the operational source of truth; QuickBooks stays
   the books. Details: [quickbooks.md](quickbooks.md).

### Weekly numbers
Rentals this week; days from pickup to invoice; average days a can stays out; can
utilization. At 9 cans and 20 rentals/week, each can must turn in ~3 days — this
view says whether to buy more cans before he does.

## 6. Security

- RLS on every table; helpers `current_company_id()` and `has_role(min_role)`.
- Drivers read only stops assigned to them and the site/contact info needed to
  complete them; no access to `invoices`, `invoice_lines`, `statements`,
  `payments`, `price_books`, or customer billing fields. Enforced in the database
  and tested with pgTAP.
- Request link writes go through a server route using the service role, with rate
  limiting and a bot check; the public never gets table access.
- Scale ticket photos live in a private Storage bucket, served by signed URL.

## 7. Repository layout (planned)

```
app/
  request/[slug]/     public request form
  office/             today, requests, cans, customers, billing, numbers, settings
  driver/             today's run, drop/pickup, scale ticket capture
  api/cron/           outbox (every 5 min); daily reminders + Monday statements
lib/
  billing/            statement loader/shaper (shared by page, PDF, email)
  dispatch/           nearest-next stop ordering
  metrics/            can-turnaround math
  outbox/             message wording + delivery
  integrations/       twilio, resend, google geocoding
  i18n/               en, es dictionaries
  pdf/                statement document
supabase/
  migrations/         schema, RLS, workflow + billing functions
  tests/              pgTAP: RLS, lifecycle, outbox
docs/
```

**Billing math lives in Postgres, not TypeScript.** Each workflow function
(`complete_stop`, `record_scale_ticket`, `issue_statements`, `record_payment`)
moves the can, writes the invoice lines and queues the message in one
transaction. pgTAP tests the arithmetic end to end. QuickBooks is not stubbed
in code yet; `customers.qbo_customer_id` and `invoices.qbo_invoice_id` are the
seam, and a `qbo` outbox channel is the planned connector.

## 8. Testing

- pgTAP (`npm run db:test`, 77 assertions): RLS per role, especially "drivers
  cannot see money"; the full lifecycle with billing amounts, price-book
  snapshotting, extended days, statements, payments and idempotent reminders;
  outbox claiming and backoff.
- vitest (35): money parsing, dates/timezone, phone normalization, stop
  ordering, can turnaround, request validation and signed form token,
  statement shaping, message wording.
- Not yet: a Playwright run against a deployed preview.

## 9. Open items

**From Andrey (Phase 1 inputs)** — the system is built against settings and seed
data until these arrive:
- Delivery fee ($250 vs $350) and the extended charge after 7 days.
- Can count, sizes, and home yard per can.
- Dumpster customer list: company, billing email, who orders.
- Landfills used and a sample scale ticket.
- QuickBooks access and accountant contact.
- Who drives the new truck and start date.
- Business details for 10DLC registration of the business number (start early;
  carrier approval takes weeks).

**Business / legal**
- Dumpster licensing: renting to other companies under American Prime may need a
  different license. Confirm with counsel before the request link is public to new
  customers.
- DBA names for roofing and dumpster brands (Joe).
- Crew pay recording in Phase 3 follows the accountant's setup.

**Infrastructure**
- Supabase project `rake-american-prime-construction` (`jfonoearbpcqsofkmqvr`,
  us-east-1) — migrations applied, smoke-tested.
- Vercel project under the 2Stack team — not yet created.
- Supabase Auth: redirect URLs, phone provider (Twilio Verify), first owner —
  see README "Going live".
- Twilio A2P 10DLC registration for the business number.
- Intuit developer app for the QuickBooks connector.
