import { describe, expect, it } from "vitest";
import { distanceMiles, orderStops } from "@/lib/dispatch/order";

const trenton = { lat: 40.2171, lng: -74.7429 };
const stop = (id: string, lat: number | null, lng: number | null, area: string | null = null) => ({
  id,
  lat,
  lng,
  area,
});

describe("orderStops", () => {
  it("goes nearest-next from the yard", () => {
    const ordered = orderStops(
      [
        stop("atlantic-city", 39.3643, -74.4229),
        stop("hamilton", 40.2298, -74.6538),
        stop("cherry-hill", 39.9348, -75.0307),
      ],
      trenton,
    );
    expect(ordered.map((s) => s.id)).toEqual(["hamilton", "cherry-hill", "atlantic-city"]);
  });

  it("puts stops without coordinates last, grouped by town", () => {
    const ordered = orderStops(
      [stop("b", null, null, "Ventnor"), stop("x", 40.23, -74.65), stop("a", null, null, "Margate")],
      trenton,
    );
    expect(ordered.map((s) => s.id)).toEqual(["x", "a", "b"]);
  });

  it("keeps input order when there is no starting point", () => {
    const ordered = orderStops([stop("1", 39.9, -75), stop("2", 40.2, -74.6)], null);
    expect(ordered[0].id).toBe("1");
  });

  it("measures distance in miles", () => {
    expect(distanceMiles(trenton, { lat: 39.3643, lng: -74.4229 })).toBeCloseTo(61, 0);
  });
});
