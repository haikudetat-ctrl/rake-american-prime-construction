# Subcontracting

Labor-only roofing jobs American Prime does for other contractors (All Season, Rampage, …).
Asked for on the Oct 21 call as the one thing Andre needed to see before signing: today it's a
weekend of WhatsApp archaeology (who went where, how many squares, what pitch), payroll on
Sunday, and contractor invoices late Sunday night. Late invoicing already cost him a $35k
receivable.

## How the money works

| | Contractor pays (per job) | Crew gets (per job, split evenly) |
| --- | --- | --- |
| Base | Contractor's rate per square (All Season $95, Rampage $110) | $50 a square |
| Pitch | +$5 a square per pitch step from 9/12 (+$20 at 12/12) | Same steps |
| Extras | Per line: plywood sheets, extra layer, second story… | Per line, added to the pot |

Pitch extra per square = `max(0, pitch − start + 1) × step`. The start pitch and the step are
set per contractor and for the crew (Office → Subcontracting → Setup), because "where does the
first $5 start" is still a question for Andre (see below).

## Flow

1. **Morning** (Office → Subcontracting): add the job: day, contractor, address, who's on it.
   The crew changes day to day; it's a set of checkboxes.
2. **Job done**: on the job, enter squares and pitch (and any extras before that). Closing:
   - freezes the rates on the job (a later rate change never rewrites it),
   - splits the crew pot evenly; leftover cents go one each to the first names, so shares
     always add up to the pot,
   - issues the contractor's invoice (numbered from the same sequence as dumpster invoices),
   - queues the invoice email (PDF attached) 15 minutes out, if the contractor has a billing
     email. Reopening in that window voids the invoice and the email is skipped.
3. **Sunday**: Subcontracting → Payroll: every closed job in the week (Mon–Sun), per person,
   with the roofs behind each amount. Jobs still open are called out, because they aren't in
   the totals.
4. **Paid**: record the check or ACH on the job. Paid in full closes the invoice.

Mistakes: an owner can reopen a closed job while its invoice has no payment. That voids the
invoice (kept on record) and closing again issues a new one with a new number. A job that
didn't happen is cancelled.

## Where it lives

- `supabase/migrations/20261021200100_subcontracting.sql`: tables, RLS (staff only; drivers
  and crews see none of it), and the workflow functions (`create_sub_job`, `update_sub_job`,
  `add_sub_job_extra`, `complete_sub_job`, `reopen_sub_job`, `cancel_sub_job`,
  `record_sub_payment`, `void_sub_payment`). The money is computed here.
- `lib/subcontract/`: invoice lines and payroll shaping (pure) and the invoice loader.
- `lib/pdf/sub-invoice-document.tsx`, `lib/outbox/messages.ts` (`subInvoiceEmail`), the
  `sub_invoice_issued` branch in `lib/outbox/drain.ts`.
- `app/office/subs/`: week board, job page, payroll, setup, invoice PDF route.
- Tests: `supabase/tests/subcontracting.test.sql`, `test/subcontract.test.ts`.

## Open questions for Andre (Tuesday)

- Where does the first pitch step start: 9/12 (four $5 steps to reach +$20 at 12/12) or
  somewhere else? Same for the crew?
- Is the crew pot always split evenly, or does a crew lead get more?
- Do extras like plywood pay the crew, and at what rate?
- Mixed-pitch roofs: one pitch per job today. Enter the steep section as an extra, or does
  the contractor pay by section?
- How the crew gets paid (cash, check, payroll service) and whether the payroll provider needs
  an export.

Not in this slice: QuickBooks sync for contractor invoices, subcontracting in the Numbers →
Cash view, and the crew seeing their own jobs on their phones.
