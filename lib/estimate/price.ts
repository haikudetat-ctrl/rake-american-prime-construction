import { DRIVERS, TIER_LABEL, type Catalog, type Driver, type Measure } from "@/lib/estimate/catalog";

/**
 * Pure pricing: measurements + price list + choices → an option per roof
 * system (good/better/best) and priced add-ons, each with its cost
 * build-up. All money in integer cents.
 */

export type RoofMeasurements = Record<Measure, number> & {
  /** Rise per 12 of run; drives the labor band. */
  pitch: number;
  stories: number;
  /** Existing layers to tear off. */
  layers: number;
};

export type EstimateInputs = {
  systemIds: string[];
  /** Add-on id → quantity in its unit (feet, each). */
  addons: Record<string, number>;
  includePermit: boolean;
  includeDumpster: boolean;
};

export type CostLine = {
  kind: "material" | "labor" | "job";
  name: string;
  qty: number;
  unit: string;
  unitCents: number;
  totalCents: number;
};

export type PricedOption = {
  systemId: string;
  name: string;
  brand: string;
  tier: "good" | "better" | "best";
  tierLabel: string;
  warranty: string;
  marginPct: number;
  costCents: number;
  priceCents: number;
  lines: CostLine[];
};

export type PricedAddon = {
  addonId: string;
  name: string;
  qty: number;
  unitLabel: string;
  costCents: number;
  priceCents: number;
};

export type Estimate = { options: PricedOption[]; addons: PricedAddon[]; warnings: string[] };

export const MAX_OPTIONS = 3;

export function driverQuantity(m: RoofMeasurements, driver: Driver): number {
  if (driver === "job") return 1;
  return DRIVERS[driver].measures.reduce((sum, key) => sum + (m[key] ?? 0), 0);
}

/** Price that leaves `marginPct` of the price as gross margin, rounded up to the next $`step`. */
export function priceForMargin(costCents: number, marginPct: number, stepDollars = 10): number {
  if (costCents <= 0) return 0;
  const raw = costCents / (1 - marginPct / 100);
  const step = stepDollars * 100;
  return Math.ceil(Math.round(raw) / step) * step;
}

/** Whole purchase units, rounded up; tiny float noise (0.30000000004) never buys an extra unit. */
export function unitsNeeded(amount: number, coverage: number, wastePct: number): number {
  if (amount <= 0) return 0;
  return Math.ceil(Number(((amount * (1 + wastePct / 100)) / coverage).toFixed(6)));
}

export function laborRate(catalog: Catalog, pitch: number): number {
  const bands = [...catalog.labor.pitchBands].sort((a, b) => a.maxPitch - b.maxPitch);
  return (bands.find((b) => pitch <= b.maxPitch) ?? bands[bands.length - 1]).centsPerSquare;
}

export function priceEstimate(catalog: Catalog, m: RoofMeasurements, inputs: EstimateInputs): Estimate {
  const warnings: string[] = [];
  if (m.squares <= 0) warnings.push("Roof area is zero: enter the squares from the measurement report.");
  const bands = [...catalog.labor.pitchBands].sort((a, b) => a.maxPitch - b.maxPitch);
  if (m.pitch > bands[bands.length - 1].maxPitch) {
    warnings.push(`Pitch ${m.pitch}/12 is steeper than the labor table; priced at the steepest band.`);
  }
  const materials = new Map(catalog.materials.map((x) => [x.id, x]));

  // Labor and job costs are the same whichever shingle is chosen.
  const squares = m.squares;
  const shared: CostLine[] = [];
  const add = (kind: CostLine["kind"], name: string, qty: number, unit: string, unitCents: number) => {
    if (qty > 0 && unitCents > 0) shared.push({ kind, name, qty, unit, unitCents, totalCents: Math.round(qty * unitCents) });
  };
  add("labor", `Install labor (${m.pitch}/12 pitch)`, squares, "sq", laborRate(catalog, m.pitch));
  if (m.stories > 1) add("labor", `Extra for ${m.stories} stories`, squares * (m.stories - 1), "sq", catalog.labor.extraStoryCentsPerSquare);
  if (m.layers > 0) add("labor", `Tear-off, ${m.layers} layer${m.layers > 1 ? "s" : ""}`, squares * m.layers, "sq", catalog.labor.tearOffCentsPerSquarePerLayer);
  add("labor", "Decking replaced", m.deck_sheets, "sheet", catalog.labor.deckSheetCents);
  if (inputs.includeDumpster) add("job", "Dumpster", 1, "job", catalog.jobCosts.dumpsterCents);
  if (inputs.includePermit) add("job", "Permit", 1, "job", catalog.jobCosts.permitCents);

  const options: PricedOption[] = [];
  for (const systemId of inputs.systemIds.slice(0, MAX_OPTIONS)) {
    const system = catalog.systems.find((s) => s.id === systemId);
    if (!system) {
      warnings.push(`A chosen roof system is no longer in the price list.`);
      continue;
    }
    const lines: CostLine[] = [];
    for (const materialId of system.materialIds) {
      const material = materials.get(materialId);
      if (!material) continue;
      const amount = driverQuantity(m, material.driver);
      const qty = unitsNeeded(amount, material.coverage, material.wastePct);
      if (qty > 0) lines.push({ kind: "material", name: material.name, qty, unit: material.unit, unitCents: material.costCents, totalCents: qty * material.costCents });
    }
    lines.push(...shared);
    if (system.laborAdjustCentsPerSquare && squares > 0) {
      lines.push({
        kind: "labor", name: `${system.name} install adjustment`, qty: squares, unit: "sq",
        unitCents: system.laborAdjustCentsPerSquare, totalCents: Math.round(squares * system.laborAdjustCentsPerSquare),
      });
    }
    const costCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
    const marginPct = system.marginPct ?? catalog.defaultMarginPct;
    options.push({
      systemId: system.id, name: system.name, brand: system.brand, tier: system.tier, tierLabel: TIER_LABEL[system.tier],
      warranty: system.warranty, marginPct, costCents, priceCents: priceForMargin(costCents, marginPct), lines,
    });
  }
  options.sort((a, b) => a.priceCents - b.priceCents);

  const addons: PricedAddon[] = [];
  for (const [addonId, rawQty] of Object.entries(inputs.addons)) {
    const addon = catalog.addons.find((a) => a.id === addonId);
    const qty = Math.max(0, Math.round(rawQty * 100) / 100);
    if (!addon || qty === 0) continue;
    const costCents = Math.round(qty * addon.costCentsPerUnit);
    addons.push({ addonId, name: addon.name, qty, unitLabel: addon.unitLabel, costCents, priceCents: priceForMargin(costCents, catalog.defaultMarginPct, 5) });
  }
  return { options, addons, warnings };
}

/** Default add-on quantity from the measurements (gutters → eaves length, skylight reflash → skylights). */
export function defaultAddonQty(m: RoofMeasurements, driver: Driver): number {
  return driver === "job" ? 1 : driverQuantity(m, driver);
}
