# Phase 3 — Job costing, reviews and referrals

Source: the American Prime Systems Plan (Phase 3): "did I actually make money on that job?", plus
reviews and referrals. Same app, same roles (owner and office see everything; crews never see money).

Decisions (Oct 20):

| Question | Decision |
|---|---|
| Crew pay | Entered per job by owner/office (flat or per square). Lined up with QuickBooks once the accountant weighs in. |
| Materials | Bulk stock tracked: buys add quantity at cost, pulls charge a job at the running average cost. Supplier deliveries for a job entered as bills. |
| Review/referral timing | After the crew taps Done, the owner checks the job and taps **Mark final**; that starts the sequence. |
| Rewards | Tracked only: "reward owed" once the referred job is paid; Andrey pays (gift card or bank) and taps Paid. |

## 3a. Job costing and cash — built (Oct 20)

- **Job P&L** (Office → Jobs → a job): contract total and payments received against costs by kind:
  crew, supplier materials, stock pulled, our dumpster, our gutters, permit, other. Gross profit and
  margin, and the estimate's planned cost beside the actual, line by line where they match.
- **Own equipment at real cost**: one tap adds our dumpster (default $250) or our gutters (default
  $2.50/ft, defaulting to the job's gutter footage), the figures from the call, editable in Settings.
- **Bulk stock** (Office → Stock): items with quantity on hand and average cost. A buy adds quantity
  and re-averages; a pull charges a job at the current average and reduces the count; returns credit
  the job back. A count adjustment fixes the on-hand number without touching jobs.
- **Payments on roofing jobs**: deposit / progress / final, method and reference. Paid in full is
  what makes a referral reward owed (3b).
- **Cash view** (Numbers → Cash): by week, money out (crew, supplier bills, permits, stock buys —
  not stock pulls or own-equipment charges, which aren't new cash), money in (roofing and dumpster
  payments), and money owed to you (signed jobs not fully paid, open dumpster statements). So a big
  payroll week shows next to the payments still coming for those jobs.

## 3b. Reviews and referrals

- **Mark final** (owner, on a done job) sends, in order: warranty and product info for the chosen
  system (text + email with the signed agreement); a day later a short "how did we do?" link.
  - Great → Google review link (owner sets the link in Settings), then the homeowner's referral link.
  - Not great → no review link; the office gets a follow-up task and a text, like the recovery queue
    in `rake-review-referral-app`.
- **Referral link** `/r/<code>` per homeowner: the friend's request lands as a lead with source
  `referral` and who referred them. Office can also tag a lead as referred by someone.
- **Rewards**: set amount (default $100, the plan's $100–$250 range) per sold referral. Status:
  pending (referred lead open) → earned (referred job paid in full) → paid (owner records gift card
  or bank transfer, reference). Referrer gets a thank-you text when earned and when paid.
- **Numbers**: reviews requested / clicked, average rating, referrals by stage, rewards owed.

## Placeholders until we hear from Andrey / the accountant

Own-dumpster and gutter costs (from the call), crew pay entry method, default reward amount, the
Google review link, and warranty/product-info text (reuses the proposal's warranty per system).
