/**
 * Pitch extras as tiers: "from this pitch on, this much more a square".
 * All Season's sheet is +$15 from 9/12 and +$20 from 11/12. The database
 * (app.sub_tier_cents) is authoritative; this mirrors it for previews and
 * reads and writes the one-line form the setup page edits.
 */

import { formatCents, parseDollarsToCents } from "@/lib/money";

export type PitchTier = { from: number; cents: number };

/** The extra per square at a pitch: the highest tier at or below it, else 0. */
export function tierCents(tiers: PitchTier[], pitch: number): number {
  let cents = 0;
  for (const t of tiers) if (t.from <= pitch) cents = t.cents;
  return cents;
}

/** Tiers from the database: anything malformed reads as no tiers rather than a wrong amount. */
export function readTiers(value: unknown): PitchTier[] {
  if (!Array.isArray(value)) return [];
  const tiers = value.filter(
    (t): t is PitchTier => !!t && typeof t === "object" && Number.isInteger(t.from) && Number.isInteger(t.cents),
  );
  return tiers.length === value.length ? [...tiers].sort((a, b) => a.from - b.from) : [];
}

/**
 * "9: 15, 11: 20" (or "9/12 $15; 11/12 $20", one per line, ...) → tiers.
 * Blank means no pitch extra.
 */
export function parsePitchTiers(input: string): { tiers: PitchTier[] } | { error: string } {
  const parts = input.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const tiers: PitchTier[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d{1,2})(?:\s*\/\s*12)?\s*[:=]?\s*(\$?\s*[\d,]+(?:\.\d{1,2})?)$/);
    if (!m) return { error: `Couldn't read "${part}". Write each as pitch: dollars, like 9: 15.` };
    const from = Number(m[1]);
    const cents = parseDollarsToCents(m[2]);
    if (from < 1 || from > 24) return { error: "Pitches go from 1/12 to 24/12." };
    if (cents === null || cents > 100000) return { error: `Check the dollars in "${part}".` };
    if (tiers.some((t) => t.from === from)) return { error: `${from}/12 is listed twice.` };
    tiers.push({ from, cents });
  }
  return { tiers: tiers.sort((a, b) => a.from - b.from) };
}

/** Tiers back into the form's one line: "9: 15.00, 11: 20.00". */
export function formatPitchTiers(tiers: PitchTier[]): string {
  return tiers.map((t) => `${t.from}: ${(t.cents / 100).toFixed(2)}`).join(", ");
}

/**
 * Plain words for a rate. A tier at every pitch rising by the same amount is
 * the old per-step rate, so it reads the way it always did.
 */
export function describeTiers(tiers: PitchTier[]): string {
  if (tiers.length === 0) return "";
  const step = tiers[0].cents;
  const isSteps =
    tiers.length > 1 &&
    step > 0 &&
    tiers.every((t, i) => t.from === tiers[0].from + i && t.cents === step * (i + 1)) &&
    tiers.at(-1)!.from === 24;
  if (isSteps) return `+${formatCents(step)} a square for each pitch step from ${tiers[0].from}/12`;
  return tiers
    .map((t, i) => {
      const next = tiers[i + 1];
      const range = next ? (next.from - 1 === t.from ? `${t.from}/12` : `${t.from}-${next.from - 1}/12`) : `${t.from}/12 and up`;
      return `+${formatCents(t.cents)} a square at ${range}`;
    })
    .join(", ");
}

export const UNITS = ["ft", "each", "sq", "sheet", "hour", "day"] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABEL: Record<Unit, string> = { ft: "per ft", each: "each", sq: "per square", sheet: "per sheet", hour: "per hour", day: "per day" };

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as readonly string[]).includes(value);
}

/** "per ft" for a known unit; "each" for a hand-typed extra with none. */
export function unitLabel(unit: unknown): string {
  return isUnit(unit) ? UNIT_LABEL[unit] : "each";
}
