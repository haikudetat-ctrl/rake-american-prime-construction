import { describe, expect, it } from "vitest";
import { jobPnl, plannedKey } from "@/lib/jobs/pnl";

describe("job profit and loss", () => {
  const pnl = jobPnl({
    contractCents: 2000000,
    payments: [{ amountCents: 500000, voided: false }, { amountCents: 100000, voided: true }],
    costs: [
      { kind: "crew", amountCents: 270000, voided: false },
      { kind: "materials", amountCents: 396000, voided: false },
      { kind: "stock", amountCents: 57000, voided: false },
      { kind: "stock", amountCents: 76000, voided: true },
      { kind: "dumpster", amountCents: 25000, voided: false },
      { kind: "gutters", amountCents: 37500, voided: false },
    ],
    planned: {
      lines: [
        { kind: "material", name: "GAF Timberline HDZ shingles", totalCents: 396000 },
        { kind: "material", name: "Synthetic underlayment", totalCents: 48000 },
        { kind: "labor", name: "Install labor", totalCents: 270000 },
        { kind: "labor", name: "Tear-off, 1 layer", totalCents: 60000 },
        { kind: "job", name: "Dumpster", totalCents: 25000 },
        { kind: "job", name: "Permit", totalCents: 25000 },
      ],
      addons: [{ addonId: "gutters", costCents: 82500 }],
    },
  });

  it("totals costs, ignoring voided ones", () => {
    expect(pnl.costCents).toBe(270000 + 396000 + 57000 + 25000 + 37500);
    expect(pnl.byKind.stock).toBe(57000);
  });

  it("computes profit, margin and what is still owed", () => {
    expect(pnl.profitCents).toBe(2000000 - 785500);
    expect(pnl.marginPct).toBe(60.7);
    expect(pnl.paidCents).toBe(500000);
    expect(pnl.owedCents).toBe(1500000);
  });

  it("lines up actual costs with the estimate", () => {
    const row = (key: string) => pnl.compare.find((r) => r.key === key);
    expect(row("materials")).toEqual({ key: "materials", plannedCents: 444000, actualCents: 453000 });
    expect(row("crew")).toEqual({ key: "crew", plannedCents: 330000, actualCents: 270000 });
    expect(row("gutters")).toEqual({ key: "gutters", plannedCents: 82500, actualCents: 37500 });
    expect(row("permit")).toEqual({ key: "permit", plannedCents: 25000, actualCents: 0 });
  });

  it("leaves the estimate column empty when the viewer can't see it", () => {
    const office = jobPnl({ contractCents: 100, payments: [], costs: [{ kind: "crew", amountCents: 50, voided: false }] });
    expect(office.compare).toEqual([{ key: "crew", plannedCents: null, actualCents: 50 }]);
  });

  it("classifies estimate lines", () => {
    expect(plannedKey({ kind: "job", name: "Dumpster", totalCents: 1 })).toBe("dumpster");
    expect(plannedKey({ kind: "labor", name: "Decking replaced", totalCents: 1 })).toBe("crew");
  });
});
