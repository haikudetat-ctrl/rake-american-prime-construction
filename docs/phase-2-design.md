# Phase 2 — Roofing front door

Source: the American Prime Systems Plan (Phase 2) and the Oct 12 call. Goal: homeowners
reach American Prime without Andrey's personal phone, and Andrey sends a clean, priced
proposal from the roof, on his phone, that the homeowner signs on the spot.

Decisions (Oct 16):

| Question | Decision |
|---|---|
| Measurements | Upload the Roofr PDF; we read the numbers out of it. Every number stays editable. |
| Pricing | Material + labor build-up from an owner-maintained catalog, priced to a target margin. |
| Signing | Our own signing page; signed PDF with an audit page emailed to both sides. |
| Phone | One business number: calls ring Andrey and his wife together, texts land in a shared inbox, missed calls become leads. |

Same Supabase project, same app, same roles. Crews never see prices (as with drivers today).

## What gets built, in order

### 2a. Leads, intake link, pipeline — built (Oct 19)

- **Roofing request link** (`/roof/<slug>`; live as `/roof/roof`, public, no login). Same pattern as the dumpster
  link: signed form token, honeypot, rate limit, NJ-restricted geocoding. Homeowner enters
  name, phone, email, address, what they need (replacement, repair, inspection, gutters, storm
  damage), notes and optional photos. A text-consent checkbox with the disclosure text is
  stored with the lead. A gallery of past jobs (uploaded by the owner in Settings) sits on the
  page.
- **Leads** table, one per homeowner + property. Sources: request link, phone (missed call or
  new texter), entered by office, referral (Phase 3).
- **Pipeline** stages from the call: New → Contacted → Appointment set → Proposal sent → Won /
  Lost (with reason). Board view on the phone and desktop; every stage change is logged.
- **Numbers**: open proposals and their value, proposals waiting on an answer more than N days,
  win rate, and leads by source.
- Owner and office are notified of a new lead by text.

### 2b. Business phone number — built (Oct 20)

- One Twilio number (the same number registered for A2P texting).
- **Calls**: Twilio voice webhook answers with a simultaneous dial to Andrey's and his wife's
  phones (whoever picks up first gets it). Caller ID shows the customer's number. If nobody
  answers in ~20 s: voicemail, and a **missed-call lead** (or a note on the existing lead) with
  the recording. Office hours / after-hours greeting configurable.
- **Texts**: inbound texts land in an **Inbox** tied to the lead or customer (matched by phone);
  an unknown number starts a new lead. Replies go out from the business number through the
  existing outbox. STOP/HELP handled by Twilio Messaging Service; opt-outs are respected.
- Every Twilio webhook verifies Twilio's request signature (`TWILIO_AUTH_TOKEN`).
- Whoever picks up hears "press 1 to answer" first, so a personal voicemail can't take the call.
- Setup: Settings → Business phone (ring list, hours, greetings) has the two Twilio webhook URLs.
- To verify on a live number: simultaneous ring with screening (does a second phone keep ringing
  while the first is screening?), caller ID pass-through, voicemail playback and texted photos.
- Calls work as soon as the number exists. Texts to customers wait on A2P 10DLC approval.

### 2c. Measurements and the estimate builder

- **Roofr import**: upload the PDF on the lead; parse total area and squares, pitch by area
  (predominant and max), layers, stories, and the edge lengths — eaves, rakes, ridges, hips,
  valleys, step and wall flashing. Reuses the Roofr text parser from `2stack-roof-quote`
  (`parseRoofrText`), extended for edge lengths. Anything the parser can't read is left blank
  for Andrey to type. The PDF is stored with the lead.
- **Catalog** (owner-only, versioned like dumpster prices so an old proposal never reprices):
  - **Materials**: name, unit (bundle, roll, box, piece, sheet, foot), supplier cost, and how
    much one unit covers (e.g. 3 bundles per square; a ridge-cap bundle covers N feet).
  - **Quantity rules**: each material is driven by one measurement — squares (plus waste %),
    eaves, rakes, eaves + rakes, ridges + hips, valleys, flashing, or a count (skylights,
    pipe boots, vents) — rounded up to whole units.
  - **Roof systems**: a manufacturer line (e.g. GAF Timberline HDZ, UHDZ, Grand Sequoia; Owens
    Corning lines once certified) = its shingle + brand-matched accessories + its warranty text.
    A proposal offers up to three systems as good / better / best.
  - **Labor**: per square by pitch band, extra per story, tear-off per layer per square, decking
    per sheet, and fixed items.
  - **Add-ons**: skylight reflash, gutters per foot of eave, chimney flashing, etc., each built
    from materials + labor the same way.
  - **Other job costs**: dumpster (own can at cost), permit.
  - **Margin**: price = cost ÷ (1 − target margin), set by the owner per system or globally.
- **Estimate**: pick the lead's measurement, choose systems and add-ons, enter deck sheets /
  counts. The build-up (quantities, unit costs, labor, margin) is visible to owners only. Office
  sees prices but cannot change catalog or margin. Only an owner can override a price, and
  the override is logged.
- Pricing math lives in one pure, unit-tested module; the database stores the result as an
  immutable snapshot on the proposal.

### 2d. Proposal, signing, won job

- **Proposal**: cover with a satellite photo of the house (Google Maps Static, same API key;
  reuses `staticMapUrl`), scope of work from the measurements, good/better/best with price
  each, optional add-ons, each system's warranty text, terms, and company details. Rendered as
  a page and a PDF (`@react-pdf/renderer`, as statements are).
- **Send**: by text and email, with a private link. Viewing is recorded (so "proposal sent,
  not opened" shows on the pipeline).
- **Sign**: on the homeowner's phone or Andrey's, the homeowner picks an option and add-ons,
  reads the terms, agrees to sign electronically, types their name and draws a signature. We
  record time, IP, device, and a SHA-256 hash of the exact proposal version. A signed PDF with
  an audit page is emailed to the homeowner and the office. A signed proposal is locked; changes
  mean a new version.
- **Won**: signing moves the lead to Won and creates a **roofing job** (address, chosen system,
  scope, measurements, crew assignment, install date). Crews see their jobs and Start/Done
  buttons, never prices. The job is the record Phase 3 costs against.

## Data model (summary)

`leads`, `lead_events`, `lead_photos`, `gallery_photos`, `measurements` (parsed + edited,
with the source PDF), `catalog_versions` → `materials`, `roof_systems`, `system_materials`,
`labor_rates`, `addons`; `proposals` (versioned, immutable once sent) → `proposal_options`,
`proposal_lines` (cost + price snapshot), `signatures`; `jobs`, `job_assignments`;
`phone_calls`, `messages` (inbound and outbound texts). All tables carry `company_id` with RLS
by role, as in Phase 1. Workflow steps (stage change, send, sign, win) are Postgres functions,
so the lead, the proposal and the outbound message change in one transaction.

## What we need from Andrey

- Two or three recent Roofr reports (PDF), including one with gutters and a complex roof, to
  build and test the edge-length parser.
- His material list with current supplier costs and coverage (his supplier price sheet is
  fine), which accessories go with each GAF line, and the Owens Corning lines he will offer.
- Labor: what he pays per square by pitch, extra for two stories, tear-off per layer, decking
  per sheet, and other fixed items. Dumpster and permit cost per job.
- His target margin, and whether office staff may send proposals without his approval.
- Warranty text for each system (from his Roofr template), his contract terms, NJ HIC
  registration number and insurance details. **The contract language should be reviewed by his
  attorney**: NJ home improvement contracts have required contents, including the three-day
  cancellation notice.
- Photos of past jobs for the request page.
- Which phones ring for the business number, office hours, and the voicemail greeting.

## Not in Phase 2

Job costing and bulk-stock usage, crew pay, reviews and referrals (Phase 3); financing;
material ordering; customer logins; an Owens Corning catalog before his certification.
