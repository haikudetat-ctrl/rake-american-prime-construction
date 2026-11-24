/**
 * The day's dispatch board (Figma V2 43, and the Future "Fleet ready for the day" idea
 * built from records Rake already keeps). Pure functions so the grouping and the counts
 * can be tested without a database.
 */

export type StopKind = "drop" | "pickup" | "dump";

export type BoardStop = {
  id: string;
  kind: StopKind;
  status: string;
  driverId: string | null;
  rentalId: string | null;
  customer: string | null;
  address: string | null;
  area: string | null;
  /** Where the can goes or how to get in: the site's note, then the rental's. */
  placement: string | null;
  can: string | null;
  sizeYards: number | null;
};

export type BoardCan = { id: string; label: string; sizeYards: number; status: string };

export type Run = { driverId: string | null; name: string; stops: BoardStop[]; open: number };

/** One run per person with stops that day (in the order given), then the stops nobody has. */
export function groupRuns(stops: BoardStop[], people: { userId: string; name: string }[]): Run[] {
  const known = new Set(people.map((p) => p.userId));
  const runs: Run[] = people.map((p) => {
    const mine = stops.filter((s) => s.driverId === p.userId);
    return { driverId: p.userId, name: p.name, stops: mine, open: mine.filter(isOpen).length };
  });
  // A stop assigned to someone who left the team still needs a driver.
  const nobody = stops.filter((s) => !s.driverId || !known.has(s.driverId));
  runs.push({ driverId: null, name: "Not assigned", stops: nobody, open: nobody.filter(isOpen).length });
  return runs.filter((r) => r.stops.length > 0);
}

export function isOpen(stop: Pick<BoardStop, "status">): boolean {
  return stop.status === "scheduled";
}

/** Open stops nobody is driving: the rail's "needs a driver" card. */
export function needsDriver(runs: Run[]): BoardStop[] {
  return (runs.find((r) => r.driverId === null)?.stops ?? []).filter(isOpen);
}

/** The line under the title: "5 stops · 2 done · 1 needs a driver". Never a total that hides the unassigned. */
export function dispatchSummary(stops: BoardStop[], unassigned: number): string {
  if (stops.length === 0) return "No stops scheduled";
  const done = stops.filter((s) => s.status === "done").length;
  const parts = [stops.length === 1 ? "1 stop" : `${stops.length} stops`];
  if (done) parts.push(`${done} done`);
  if (unassigned) parts.push(unassigned === 1 ? "1 needs a driver" : `${unassigned} need a driver`);
  return parts.join(" · ");
}

export type FleetSnapshot = {
  inYard: BoardCan[];
  outOfService: number;
  out: number;
  /** Open drops that day, by size, against cans of that size in the yard now. */
  short: { sizeYards: number; drops: number; inYard: number }[];
};

/**
 * What the yard looks like right now. "short" compares open drops on the board with cans
 * of the same size in the yard, so the office sees a squeeze before the driver does. It
 * is a warning, not a booking: cans come back from pickups during the day.
 */
export function fleetSnapshot(cans: BoardCan[], stops: BoardStop[]): FleetSnapshot {
  const inYard = cans.filter((c) => c.status === "available");
  const drops = new Map<number, number>();
  for (const s of stops) {
    // A drop with a can already picked is spoken for; only count the ones still to choose.
    if (s.kind === "drop" && isOpen(s) && !s.can && s.sizeYards) drops.set(s.sizeYards, (drops.get(s.sizeYards) ?? 0) + 1);
  }
  const short = [...drops.entries()]
    .map(([sizeYards, n]) => ({ sizeYards, drops: n, inYard: inYard.filter((c) => c.sizeYards === sizeYards).length }))
    .filter((x) => x.drops > x.inYard)
    .sort((a, b) => a.sizeYards - b.sizeYards);
  return {
    inYard,
    outOfService: cans.filter((c) => c.status === "out_of_service").length,
    out: cans.filter((c) => c.status === "on_site" || c.status === "in_transit").length,
    short,
  };
}

const KIND_LABEL: Record<StopKind, string> = { drop: "Drop", pickup: "Pickup", dump: "Dump" };

export function kindLabel(kind: StopKind): string {
  return KIND_LABEL[kind];
}

/** "C-12 · 20 yd", or just the size when no can is picked yet. */
export function canLabel(stop: Pick<BoardStop, "can" | "sizeYards">): string {
  if (stop.can && stop.sizeYards) return `${stop.can} · ${stop.sizeYards} yd`;
  if (stop.can) return stop.can;
  if (stop.sizeYards) return `${stop.sizeYards} yd, can not picked`;
  return "No size set";
}
