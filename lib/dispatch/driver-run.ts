/**
 * The driver's day as one next stop (Figma V2 49, Future "One stop, clearly"): the first
 * stop not done in run order, the one after it, the rest still to do, and what is done.
 * Drivers can still work stops out of order; this only decides what leads the screen.
 */
export type DriverStop = { stop_id: string; status: string };

export function splitRun<T extends DriverStop>(stops: T[]) {
  const open = stops.filter((s) => s.status !== "done");
  const done = stops.filter((s) => s.status === "done");
  const next = open[0] ?? null;
  return {
    next,
    /** 1-based place of the next stop in the whole run, for "stop 2 of 5". */
    position: next ? stops.indexOf(next) + 1 : 0,
    after: open[1] ?? null,
    later: open.slice(1),
    done,
  };
}

/** A maps link that opens turn-by-turn directions on the phone. */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
