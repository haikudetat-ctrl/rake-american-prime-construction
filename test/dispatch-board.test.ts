import { describe, expect, it } from "vitest";
import { canLabel, dispatchSummary, fleetSnapshot, groupRuns, needsDriver, type BoardCan, type BoardStop } from "@/lib/dispatch/board";
import { directionsUrl, splitRun } from "@/lib/dispatch/driver-run";

// Synthetic records only.
const stop = (id: string, over: Partial<BoardStop> = {}): BoardStop => ({
  id,
  kind: "drop",
  status: "scheduled",
  driverId: null,
  rentalId: `r-${id}`,
  customer: "Example Builders",
  address: "1 Example Road",
  area: null,
  placement: null,
  can: null,
  sizeYards: 20,
  ...over,
});
const people = [
  { userId: "u-alex", name: "Alex" },
  { userId: "u-sam", name: "Sam" },
];

describe("groupRuns", () => {
  it("gives each driver their own run and puts unassigned stops last", () => {
    const runs = groupRuns([stop("1", { driverId: "u-alex" }), stop("2"), stop("3", { driverId: "u-alex", status: "done" })], people);
    expect(runs.map((r) => [r.name, r.stops.map((s) => s.id), r.open])).toEqual([
      ["Alex", ["1", "3"], 1],
      ["Not assigned", ["2"], 1],
    ]);
  });

  it("treats a stop held by someone no longer on the team as unassigned", () => {
    const runs = groupRuns([stop("1", { driverId: "u-gone" })], people);
    expect(runs).toHaveLength(1);
    expect(runs[0].driverId).toBeNull();
    expect(needsDriver(runs).map((s) => s.id)).toEqual(["1"]);
  });

  it("only counts open stops as needing a driver", () => {
    const runs = groupRuns([stop("1", { status: "done" }), stop("2")], people);
    expect(needsDriver(runs).map((s) => s.id)).toEqual(["2"]);
  });
});

describe("dispatchSummary", () => {
  it("says plainly when nothing is scheduled", () => {
    expect(dispatchSummary([], 0)).toBe("No stops scheduled");
  });

  it("names done and unassigned stops alongside the total", () => {
    expect(dispatchSummary([stop("1", { status: "done" }), stop("2"), stop("3")], 2)).toBe("3 stops · 1 done · 2 need a driver");
    expect(dispatchSummary([stop("1")], 1)).toBe("1 stop · 1 needs a driver");
  });
});

describe("fleetSnapshot", () => {
  const cans: BoardCan[] = [
    { id: "a", label: "C-12", sizeYards: 20, status: "available" },
    { id: "b", label: "C-08", sizeYards: 20, status: "on_site" },
    { id: "c", label: "C-15", sizeYards: 15, status: "out_of_service" },
    { id: "d", label: "C-02", sizeYards: 15, status: "in_transit" },
  ];

  it("counts what is in the yard, out on jobs and out of service", () => {
    const fleet = fleetSnapshot(cans, []);
    expect(fleet.inYard.map((c) => c.label)).toEqual(["C-12"]);
    expect(fleet.out).toBe(2);
    expect(fleet.outOfService).toBe(1);
    expect(fleet.short).toEqual([]);
  });

  it("warns when open drops of a size outnumber cans of that size in the yard", () => {
    const fleet = fleetSnapshot(cans, [stop("1"), stop("2"), stop("3", { sizeYards: 15 }), stop("4", { status: "done" })]);
    expect(fleet.short).toEqual([
      { sizeYards: 15, drops: 1, inYard: 0 },
      { sizeYards: 20, drops: 2, inYard: 1 },
    ]);
  });

  it("ignores drops that already have a can and pickups", () => {
    const fleet = fleetSnapshot(cans, [stop("1", { can: "C-12" }), stop("2", { kind: "pickup" }), stop("3")]);
    expect(fleet.short).toEqual([]);
  });
});

describe("canLabel", () => {
  it("shows the can and size, or says no can is picked yet", () => {
    expect(canLabel({ can: "C-12", sizeYards: 20 })).toBe("C-12 · 20 yd");
    expect(canLabel({ can: null, sizeYards: 20 })).toBe("20 yd, can not picked");
    expect(canLabel({ can: null, sizeYards: null })).toBe("No size set");
  });
});

describe("splitRun", () => {
  const run = [
    { stop_id: "1", status: "done" },
    { stop_id: "2", status: "scheduled" },
    { stop_id: "3", status: "scheduled" },
    { stop_id: "4", status: "scheduled" },
  ];

  it("leads with the first stop not done, in run order", () => {
    const day = splitRun(run);
    expect(day.next?.stop_id).toBe("2");
    expect(day.position).toBe(2);
    expect(day.after?.stop_id).toBe("3");
    expect(day.later.map((s) => s.stop_id)).toEqual(["3", "4"]);
    expect(day.done.map((s) => s.stop_id)).toEqual(["1"]);
  });

  it("has no next stop when the run is finished or empty", () => {
    expect(splitRun([{ stop_id: "1", status: "done" }]).next).toBeNull();
    expect(splitRun([]).next).toBeNull();
  });

  it("builds a directions link with the address encoded", () => {
    expect(directionsUrl("1 Example Rd, Ventnor & Margate")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1%20Example%20Rd%2C%20Ventnor%20%26%20Margate",
    );
  });
});
