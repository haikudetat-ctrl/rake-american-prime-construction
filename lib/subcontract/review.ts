import { jobLines } from './view';
export type Rate = { base: number; from: number; step: number };
export type ReviewExtra = { description: string; qty: number; bill_unit_cents: number; pay_unit_cents: number };
/** Read-only estimate of the existing complete_sub_job formula. Postgres remains authoritative. */
export function closeoutReview(squares: number, pitch: number, bill: Rate, pay: Rate, extras: ReviewExtra[], crewSize: number) {
  const total = (rate: Rate, what: 'bill_unit_cents' | 'pay_unit_cents') => jobLines(
    { squares, pitch, baseCents: rate.base, pitchCents: Math.max(0, pitch - rate.from + 1) * rate.step },
    extras.map(e => ({ description: e.description, qty: e.qty, unitCents: e[what] })),
  ).reduce((sum, line) => sum + line.amountCents, 0);
  const billCents = total(bill, 'bill_unit_cents');
  const payCents = total(pay, 'pay_unit_cents');
  const share = crewSize ? Math.floor(payCents / crewSize) : 0;
  return { billCents, payCents, share, remainder: crewSize ? payCents - share * crewSize : 0 };
}
