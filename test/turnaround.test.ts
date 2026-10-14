import { describe, expect, it } from "vitest";
import { cansNeeded, fleetVerdict, maxDaysPerTurn } from "@/lib/metrics/turnaround";

describe("can turnaround", () => {
  it("9 cans at 20 rentals a week leaves about 3 days per turn", () => {
    expect(maxDaysPerTurn(9, 20)).toBeCloseTo(3.15, 2);
  });

  it("handles an empty fleet or target", () => {
    expect(maxDaysPerTurn(0, 20)).toBeNull();
    expect(maxDaysPerTurn(9, 0)).toBeNull();
  });

  it("counts cans needed including the dump day", () => {
    // 2 days out + 1 dump day = 3 days per turn; 20/week needs ceil(60/7) = 9.
    expect(cansNeeded(2, 20)).toBe(9);
    expect(cansNeeded(4, 20)).toBe(15);
  });

  it("calls the fleet enough, tight or short", () => {
    expect(fleetVerdict(9, 1, 20)).toBe("enough");
    expect(fleetVerdict(9, 2, 20)).toBe("tight");
    expect(fleetVerdict(9, 4, 20)).toBe("short");
    expect(fleetVerdict(9, null, 20)).toBeNull();
  });
});
