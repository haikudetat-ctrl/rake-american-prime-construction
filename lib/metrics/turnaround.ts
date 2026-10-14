/**
 * How many days each can may stay out (drop to back in the yard) for the
 * fleet to support a weekly rental target. 9 cans at 20 rentals a week is
 * 9 × 7 / 20 = 3.15 days.
 */
export function maxDaysPerTurn(cansInService: number, rentalsPerWeek: number): number | null {
  if (cansInService <= 0 || rentalsPerWeek <= 0) return null;
  return (cansInService * 7) / rentalsPerWeek;
}

/** Cans needed to hit a weekly target at the current average days out (+1 day for the dump run). */
export function cansNeeded(avgDaysOut: number, rentalsPerWeek: number): number {
  return Math.ceil(((avgDaysOut + 1) * rentalsPerWeek) / 7);
}

export type FleetVerdict = "enough" | "tight" | "short";

export function fleetVerdict(
  cansInService: number,
  avgDaysOut: number | null,
  rentalsPerWeek: number,
): FleetVerdict | null {
  if (avgDaysOut === null) return null;
  const needed = cansNeeded(avgDaysOut, rentalsPerWeek);
  if (needed <= cansInService - 1) return "enough";
  if (needed <= cansInService) return "tight";
  return "short";
}
