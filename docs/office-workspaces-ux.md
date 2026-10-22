# Office workspaces — first UX pass

The office now has Home, Roofing, Subcontracting and Dumpsters as its four primary destinations. Desktop retains a sidebar; mobile has a fixed bottom bar with safe-area spacing. Local navigation groups the existing functions by business. Inbox, shared Customers, Reporting and Settings remain global utilities. A utility page does not pretend to belong to one business.

Existing lead, proposal, roofing job, rental, invoice and subcontract job URLs remain valid. Proposal details select Roofing; rental details select Dumpsters; subcontract details select Subcontracting. `/office` is now the cross-business Home. Dispatch moved to `/office/dumpsters`; old `/office?date=…` bookmarks redirect there with their query/feedback intact. Dispatch assignment and route ordering still use the existing actions.

Home uses staff-scoped reads for new leads, pending rental requests, today's roofing and subcontracting jobs, scheduled dumpster stops, final dumpster invoices ready for billing, overdue subcontract invoices, and subcontract jobs awaiting closeout. Lists are bounded and labeled; full workspaces remain available. Failed reads are explicitly unavailable, not zero counts. Missing subcontract tables suppress its forms and financial tiles rather than inventing empty schedules or balances.

Subcontracting has Jobs, Crew Pay, Invoices and Setup navigation. Cards distinguish work status, contractor invoice status and earned crew shares. Week and work-status filter are carried through detail links and action feedback. Assign/save buttons show pending feedback. The invoice list uses existing invoices and non-void payments; it adds no payment workflow or data model.

Finishing a job first reviews squares, pitch, extras, the contractor bill, crew pot, individual shares, recipient and the 15-minute email queue consequence. The user must acknowledge that review before committing; the commit and edit controls disable while pending. The database's existing `complete_sub_job` function remains authoritative, including rounding, crew ordering, invoice creation and delivery queuing. The preview is read-only and uses the loaded rates; it is not a new price engine or an atomic rate reservation. A concurrent rate/crew/extra edit after page load can change the final database result. Refresh the job before closing if another office user is editing it; a future database-backed preview/version check should address that race.

Crew Pay means earnings, not proof of worker payment. No paid-worker tracking is invented. Reporting explicitly labels its existing cash view as **roofing + dumpsters**, excluding subcontracting. Customer identity, auth checks, RLS, financial rules and driver/crew interfaces are unchanged. No new migrations or dependencies are required by this PR.

## Verification (2026-10-22)

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 24 files, 166 tests passed. New tests cover detail-route ownership, four stable destinations, local week/filter sanitization, preview rounding/pitch/remainder cases, Home populated/empty/missing-schema states, legacy dispatch links and staff/driver/crew boundaries.
- `npm run build`: blocked by the environment's outbound Google Fonts restriction (proxy returned HTTP 403). This is the existing `next/font/google` dependency in the baseline.
- Production compilation, type checking and page generation **passed** with `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` pointing to a temporary test-only stylesheet fixture using local Arial. The repository's fonts and production configuration were not altered. This does not validate real Google Font downloads.
- `npm run db:test`: attempted, blocked before database startup because `/usr/lib/postgresql/16/bin/initdb` is not installed. No database test is reported as passed.
- Chromium/Playwright against a local Vite harness using the actual Home, OfficeNav and Closeout components with synthetic data, stubbed navigation and a stubbed action: closeout at 320/390/768/1440px, Home at 320/390/1440px, no horizontal overflow; review/edit/review; checkbox validation; pending duplicate prevention; proposal/rental/subcontract selection; browser Back/Forward; week/filter links; no browser errors in the closeout run.
- These component/browser checks do **not** constitute authenticated end-to-end Supabase or Next Server Action verification. No real invoice was issued, queued or emailed. Missing schema and role boundaries were also checked with server-rendering/unit mocks.
- `git diff --check`: passed. No migration, auth policy, service-role client, driver page or crew page changes.

The screenshot shell is intentionally labeled **Synthetic test**. Screenshots use the application CSS with fallback fonts and real components, not a production session:

| Home | Closeout |
| --- | --- |
| [Desktop](screenshots/office-home-desktop.png) | [Desktop](screenshots/subcontract-closeout-desktop.png) |
| [Mobile](screenshots/office-home-mobile.png) | [Mobile](screenshots/subcontract-closeout-mobile.png) |

## Live prerequisite and follow-ups

The supplied October 22 02:40 UTC baseline reported that production Supabase `jfonoearbpcqsofkmqvr` lacked `20261021200000_stop_photos.sql` and `20261021200100_subcontracting.sql`, with no `sub_*` tables. Both migrations are present in current main. Production migration state was not changed or independently reverified here. Authorized deployment work must verify/apply the required schema separately; this draft must not be interpreted as a production migration or deployment request.

Deferred from this coherent first pass:

- Yesterday's crew reuse: needs date-aware suggestions, explicit review, and handling multiple crews/inactive workers; no automatic assignment in this PR.
- Atomic closeout preview/version validation against concurrent edits, and recoverable in-progress drafts after connection loss. Existing database validation continues to reject already-closed jobs; after uncertain network failure, reload and inspect status before retrying.
- Full authenticated E2E with a local/test Supabase, including assignment, closeout/reopen, payment history, email queue delay and interrupted server-action recovery.
- Pagination beyond the labeled Home/invoice caps, a shared all-business reporting model that correctly includes subcontracting cash, and richer roofing/dumpster exception queues.
- Payroll disbursement, pay-run locking, QuickBooks integration, drag-and-drop scheduling and a global search backend remain out of scope.
