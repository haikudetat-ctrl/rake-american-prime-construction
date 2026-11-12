import { jobLines } from './view';
import { tierCents, type PitchTier } from './tiers';
export type Rate = { base: number; tiers: PitchTier[]; minimumCents?: number | null };
export type ReviewExtra = { description: string; qty: number; bill_unit_cents: number; pay_unit_cents: number; unit?: string | null };
/** Read-only estimate of complete_sub_job's formula. Postgres remains authoritative. */
export function closeoutReview(squares: number, pitch: number, bill: Rate, pay: Rate, extras: ReviewExtra[], crewSize: number) {
  const total = (rate: Rate, what: 'bill_unit_cents' | 'pay_unit_cents') => jobLines(
    { squares, pitch, baseCents: rate.base, pitchCents: squares > 0 ? tierCents(rate.tiers, pitch) : 0 },
    extras.map(e => ({ description: e.description, qty: e.qty, unitCents: e[what], unit: e.unit })),
  ).reduce((sum, line) => sum + line.amountCents, 0);
  const beforeMinimum = total(bill, 'bill_unit_cents');
  // The minimum is for roofs only, like the database's.
  const minimumCents = squares > 0 && bill.minimumCents && beforeMinimum < bill.minimumCents ? bill.minimumCents - beforeMinimum : 0;
  const billCents = beforeMinimum + minimumCents;
  const payCents = total(pay, 'pay_unit_cents');
  const share = crewSize ? Math.floor(payCents / crewSize) : 0;
  return { billCents, payCents, minimumCents, share, remainder: crewSize ? payCents - share * crewSize : 0 };
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
