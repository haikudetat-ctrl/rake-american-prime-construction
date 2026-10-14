export type Point = { lat: number; lng: number };

export type RoutableStop = {
  id: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
};

/** Great-circle distance in miles. */
export function distanceMiles(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/**
 * Orders a day's stops for one driver: nearest-next from the starting yard.
 *
 * This is deliberately not route optimization. At 3–4 stops a day from two
 * yards, nearest-next is within a few miles of optimal, and the plan defers
 * real routing until there are two drivers or 20+ rentals a week. Stops
 * without coordinates (address not geocoded) go last, grouped by town, so
 * the driver still sees them together.
 */
export function orderStops<T extends RoutableStop>(stops: T[], start: Point | null): T[] {
  const located = stops.filter((s): s is T & Point => s.lat !== null && s.lng !== null);
  const unlocated = stops
    .filter((s) => s.lat === null || s.lng === null)
    .sort((a, b) => (a.area ?? "").localeCompare(b.area ?? ""));

  const ordered: T[] = [];
  const remaining = [...located];
  let here: Point | null = start;
  while (remaining.length > 0) {
    let best = 0;
    if (here) {
      let bestDistance = Infinity;
      remaining.forEach((stop, i) => {
        const d = distanceMiles(here as Point, stop);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
    }
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    here = next;
  }
  return [...ordered, ...unlocated];
}
