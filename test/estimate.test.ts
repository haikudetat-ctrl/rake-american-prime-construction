import { describe, expect, it } from "vitest";
import { catalogSchema, PLACEHOLDER_CATALOG } from "@/lib/estimate/catalog";
import { defaultAddonQty, laborRate, priceEstimate, priceForMargin, unitsNeeded, type RoofMeasurements } from "@/lib/estimate/price";
import { parseRoofrText } from "@/lib/estimate/roofr";

const roof: RoofMeasurements = {
  squares: 30, pitch: 6, stories: 1, layers: 1,
  eaves: 150, rakes: 90, ridges: 40, hips: 0, valleys: 20, step_flashing: 16, wall_flashing: 0,
  skylights: 1, pipe_boots: 3, vents: 0, chimneys: 0, deck_sheets: 4,
};

describe("price list", () => {
  it("the placeholder catalog is valid", () => {
    expect(catalogSchema.safeParse(PLACEHOLDER_CATALOG).success).toBe(true);
  });
  it("rejects a system that uses a missing material", () => {
    const bad = { ...PLACEHOLDER_CATALOG, systems: [{ ...PLACEHOLDER_CATALOG.systems[0], materialIds: ["nope"] }] };
    expect(catalogSchema.safeParse(bad).success).toBe(false);
  });
});

describe("quantities", () => {
  it("rounds up to whole units after waste, without float noise", () => {
    expect(unitsNeeded(30, 1 / 3, 10)).toBe(99); // 30 sq × 1.10 = 33 sq → 99 bundles
    expect(unitsNeeded(30, 1 / 3, 0)).toBe(90);
    expect(unitsNeeded(0, 10, 10)).toBe(0);
    expect(unitsNeeded(240, 120, 5)).toBe(3); // 252 ft of starter → 3 bundles
  });
  it("picks the labor band by pitch", () => {
    expect(laborRate(PLACEHOLDER_CATALOG, 6)).toBe(9000);
    expect(laborRate(PLACEHOLDER_CATALOG, 8)).toBe(11000);
    expect(laborRate(PLACEHOLDER_CATALOG, 40)).toBe(17500);
  });
  it("prices to the margin, rounded up to $10", () => {
    expect(priceForMargin(700000, 30)).toBe(1000000);
    expect(priceForMargin(700001, 30)).toBe(1001000); // a cent over rounds up to the next $10
    expect(priceForMargin(0, 30)).toBe(0);
  });
});

describe("estimate", () => {
  const estimate = priceEstimate(PLACEHOLDER_CATALOG, roof, {
    systemIds: ["gaf-best", "gaf-good", "gaf-better"],
    addons: { gutters: 150, "skylight-reflash": 1, "chimney-flashing": 0 },
    includeDumpster: true,
    includePermit: true,
  });

  it("orders options by price and keeps their build-up", () => {
    expect(estimate.options.map((o) => o.tier)).toEqual(["good", "better", "best"]);
    const good = estimate.options[0];
    const shingles = good.lines.find((l) => l.name.includes("HDZ shingles"))!;
    expect(shingles).toMatchObject({ qty: 99, unitCents: 4000, totalCents: 396000 });
    expect(good.lines.find((l) => l.name.startsWith("Install labor"))!.totalCents).toBe(270000);
    expect(good.lines.find((l) => l.name.startsWith("Tear-off"))!.totalCents).toBe(60000);
    expect(good.lines.find((l) => l.name === "Decking replaced")!.totalCents).toBe(34000);
    expect(good.costCents).toBe(good.lines.reduce((s, l) => s + l.totalCents, 0));
    expect(good.priceCents).toBe(priceForMargin(good.costCents, 30));
  });

  it("charges the best system's labor adjustment only to that option", () => {
    const best = estimate.options[2];
    expect(best.lines.some((l) => l.name.includes("install adjustment"))).toBe(true);
    expect(estimate.options[0].lines.some((l) => l.name.includes("install adjustment"))).toBe(false);
  });

  it("prices add-ons and skips zero quantities", () => {
    expect(estimate.addons.map((a) => a.addonId)).toEqual(["gutters", "skylight-reflash"]);
    expect(estimate.addons[0]).toMatchObject({ qty: 150, costCents: 82500, priceCents: 118000 });
  });

  it("defaults add-on quantities from the measurements", () => {
    expect(defaultAddonQty(roof, "eaves")).toBe(150);
    expect(defaultAddonQty(roof, "skylights")).toBe(1);
  });

  it("warns instead of guessing", () => {
    const flat = priceEstimate(PLACEHOLDER_CATALOG, { ...roof, squares: 0, pitch: 40 }, {
      systemIds: ["gaf-good", "gone"], addons: {}, includeDumpster: false, includePermit: false,
    });
    expect(flat.warnings).toHaveLength(3);
  });
});

describe("Roofr report text", () => {
  it("reads area, pitch and edge lengths", () => {
    const parsed = parseRoofrText(`Roofr Measurement Report
      Total roof area: 2,857 sqft  Predominant pitch: 8/12  Total roof facets 14
      Two layer area: 200 sqft  Two story area: 1,500 sqft
      Eaves 152ft 6in  Rakes 88ft  Ridges 41ft 3in  Hips 0ft  Valleys 22ft  Step flashing 16ft`);
    expect(parsed).toMatchObject({
      squares: 28.57, pitch: 8, facets: 14, twoLayerSquares: 2, twoStorySquares: 15,
      eaves: 152.5, rakes: 88, ridges: 41.25, hips: 0, valleys: 22, step_flashing: 16, wall_flashing: null,
    });
  });
  it("leaves what it can't find empty", () => {
    expect(parseRoofrText("nothing useful").found).toEqual([]);
  });
});

describe("Roofr PDF", () => {
  it("extracts text a parser can read (synthetic report from 2stack-roof-quote)", async () => {
    const { readFile } = await import("node:fs/promises");
    const { pdfText } = await import("@/lib/estimate/roofr-pdf");
    const text = await pdfText(new Uint8Array(await readFile(new URL("./fixtures/roofr-synthetic.pdf", import.meta.url))));
    expect(parseRoofrText(text!)).toMatchObject({ squares: 28.57, pitch: 8, twoLayerSquares: 2, twoStorySquares: 15 });
  });
  it("refuses something that isn't a PDF", async () => {
    const { pdfText } = await import("@/lib/estimate/roofr-pdf");
    expect(await pdfText(new TextEncoder().encode("hello"))).toBeNull();
  });
});
