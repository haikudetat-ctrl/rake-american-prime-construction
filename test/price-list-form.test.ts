import { describe, expect, it } from "vitest";
import { catalogSchema, PLACEHOLDER_CATALOG } from "@/lib/estimate/catalog";
import { applySection, dollarsToCents, parseAmount, PriceListFormError } from "@/lib/estimate/form";

const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe("price list form values", () => {
  it("reads dollars and fractions", () => {
    expect(dollarsToCents("$1,234.50")).toBe(123450);
    expect(dollarsToCents("40")).toBe(4000);
    expect(dollarsToCents("abc")).toBeNull();
    expect(parseAmount("1/3")).toBeCloseTo(0.3333, 4);
    expect(parseAmount("120")).toBe(120);
    expect(parseAmount("1/0")).toBeNull();
  });
});

describe("applying a section", () => {
  it("edits, adds and removes materials, keeping ids", () => {
    const next = applySection(PLACEHOLDER_CATALOG, "materials", form({
      m_0_id: "gaf-hdz", m_0_name: "GAF Timberline HDZ shingles", m_0_unit: "bundle", m_0_cost: "41.25", m_0_coverage: "1/3", m_0_driver: "squares", m_0_waste: "12",
      m_1_id: "", m_1_name: "Ridge vent end plugs", m_1_unit: "bag", m_1_cost: "8", m_1_coverage: "40", m_1_driver: "ridges", m_1_waste: "0",
      m_2_id: "", m_2_name: "", m_2_cost: "", m_2_coverage: "", m_2_driver: "squares",
    }));
    expect(next.materials).toHaveLength(2);
    expect(next.materials[0]).toMatchObject({ id: "gaf-hdz", costCents: 4125, wastePct: 12 });
    expect(next.materials[1].id).toBe("ridge-vent-end-plugs");
    // Systems still point at materials that are now gone, so the whole list is refused.
    expect(catalogSchema.safeParse(next).success).toBe(false);
  });

  it("explains a bad row", () => {
    expect(() => applySection(PLACEHOLDER_CATALOG, "materials", form({
      m_0_id: "x", m_0_name: "Nails", m_0_cost: "lots", m_0_coverage: "1", m_0_driver: "squares",
    }))).toThrow(PriceListFormError);
  });

  it("saves labor bands sorted, job costs and margin", () => {
    const next = applySection(PLACEHOLDER_CATALOG, "labor", form({
      b_0_max: "12", b_0_rate: "140", b_1_max: "7", b_1_rate: "95", b_2_max: "", b_2_rate: "",
      story: "10", tearoff: "25", deck: "90", dumpster: "250", permit: "300", margin: "32",
    }));
    expect(next.labor.pitchBands).toEqual([{ maxPitch: 7, centsPerSquare: 9500 }, { maxPitch: 12, centsPerSquare: 14000 }]);
    expect(next.defaultMarginPct).toBe(32);
    expect(next.jobCosts.permitCents).toBe(30000);
    expect(catalogSchema.safeParse(next).success).toBe(true);
  });

  it("saves systems with their materials and warranty", () => {
    const next = applySection(PLACEHOLDER_CATALOG, "systems", form({
      s_0_id: "gaf-good", s_0_name: "GAF Timberline HDZ", s_0_brand: "GAF", s_0_tier: "good", s_0_active: "on",
      s_0_mat: ["gaf-hdz", "gaf-starter"], s_0_labor: "0", s_0_margin: "", s_0_warranty: "Lifetime ltd.",
      s_1_id: "", s_1_name: "Owens Corning Duration", s_1_brand: "Owens Corning", s_1_tier: "better",
      s_1_mat: ["gaf-starter"], s_1_labor: "5", s_1_margin: "35", s_1_warranty: "",
    }));
    expect(next.systems.map((s) => [s.id, s.active, s.marginPct])).toEqual([["gaf-good", true, null], ["owens-corning-duration", false, 35]]);
    expect(next.systems[1].laborAdjustCentsPerSquare).toBe(500);
  });
});
