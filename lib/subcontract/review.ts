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

/** The parts complete_sub_job fingerprints; see the closeout_fingerprint migration. */
export const FINGERPRINT_PARTS = ["crew", "extras", "rates", "contractor"] as const;
export type FingerprintPart = (typeof FINGERPRINT_PARTS)[number];
const PART_LABEL: Record<FingerprintPart, string> = {
  crew: "the crew",
  extras: "the extras",
  rates: "the billing or crew rates",
  contractor: "the contractor or its billing email",
};

/** A fingerprint posted back by the review form, or null if it is missing or malformed. */
export function parseFingerprint(input: string): Record<FingerprintPart, string> | null {
  try {
    const value: unknown = JSON.parse(input);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const parts = value as Record<string, unknown>;
    return FINGERPRINT_PARTS.every((p) => typeof parts[p] === "string") ? (parts as Record<FingerprintPart, string>) : null;
  } catch {
    return null;
  }
}

/** The `stale` query value ("crew,extras") as known parts, in a stable order. */
export function parseStale(input: unknown): FingerprintPart[] | null {
  if (typeof input !== "string") return null;
  const given = new Set(input.split(","));
  return FINGERPRINT_PARTS.filter((p) => given.has(p));
}

/** "The crew and the extras changed after you opened the review." */
export function staleSummary(parts: FingerprintPart[]): string {
  const named = parts.map((p) => PART_LABEL[p]);
  if (!named.length) return "Something on this job changed after you opened the review.";
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `${list[0].toUpperCase()}${list.slice(1)} changed after you opened the review.`;
}
