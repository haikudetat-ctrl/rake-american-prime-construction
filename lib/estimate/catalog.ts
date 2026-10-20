import { z } from "zod";

/**
 * The roofing price list ("catalog"): what materials cost, how far each unit
 * goes, which measurement drives it, what labor costs, and the margin.
 * Stored as one versioned JSON document per publish (catalog_versions), so a
 * proposal always prices against the exact version it was built from.
 */

/** Measurements a quantity can be driven by. Lengths are in feet; counts are each. */
export const MEASURES = [
  "squares", "eaves", "rakes", "ridges", "hips", "valleys", "step_flashing", "wall_flashing",
  "skylights", "pipe_boots", "vents", "chimneys", "deck_sheets",
] as const;
export type Measure = (typeof MEASURES)[number];

/** Driver choices offered in the price list, each a sum of measurements ("job" = once per job). */
export const DRIVERS = {
  squares: { label: "Roof area (squares)", measures: ["squares"] },
  eaves: { label: "Eaves (ft)", measures: ["eaves"] },
  rakes: { label: "Rakes (ft)", measures: ["rakes"] },
  eaves_rakes: { label: "Eaves + rakes (ft)", measures: ["eaves", "rakes"] },
  ridges: { label: "Ridges (ft)", measures: ["ridges"] },
  ridges_hips: { label: "Ridges + hips (ft)", measures: ["ridges", "hips"] },
  valleys: { label: "Valleys (ft)", measures: ["valleys"] },
  eaves_valleys: { label: "Eaves + valleys (ft)", measures: ["eaves", "valleys"] },
  step_flashing: { label: "Step flashing (ft)", measures: ["step_flashing"] },
  wall_flashing: { label: "Wall flashing (ft)", measures: ["wall_flashing"] },
  skylights: { label: "Skylights (each)", measures: ["skylights"] },
  pipe_boots: { label: "Pipe boots (each)", measures: ["pipe_boots"] },
  vents: { label: "Vents (each)", measures: ["vents"] },
  chimneys: { label: "Chimneys (each)", measures: ["chimneys"] },
  job: { label: "Once per job", measures: [] },
} as const satisfies Record<string, { label: string; measures: readonly Measure[] }>;
export type Driver = keyof typeof DRIVERS;
const driverKeys = Object.keys(DRIVERS) as [Driver, ...Driver[]];

const cents = z.number().int().min(0).max(100_000_000);
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const materialSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(30), // bundle, roll, box, piece…
  costCents: cents,
  /** How much of the driver one unit covers (e.g. 0.333 squares per bundle, 120 ft per bundle). */
  coverage: z.number().positive().max(100_000),
  driver: z.enum(driverKeys),
  wastePct: z.number().min(0).max(100).default(0),
});
export type Material = z.infer<typeof materialSchema>;

export const TIERS = ["good", "better", "best"] as const;
export const TIER_LABEL = { good: "Good", better: "Better", best: "Best" } as const;

export const systemSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(60),
  tier: z.enum(TIERS),
  active: z.boolean().default(true),
  /** The shingle and its brand-matched accessories. */
  materialIds: z.array(id).min(1),
  /** Extra labor per square for this system (heavier or slower shingles). */
  laborAdjustCentsPerSquare: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  /** Overrides the default margin when set. */
  marginPct: z.number().min(0).max(90).nullable().default(null),
  warranty: z.string().max(5000).default(""),
});
export type RoofSystem = z.infer<typeof systemSchema>;

export const laborSchema = z.object({
  /** Labor per square by pitch: the first band whose maxPitch is ≥ the roof's pitch applies. */
  pitchBands: z.array(z.object({ maxPitch: z.number().min(0).max(30), centsPerSquare: cents })).min(1),
  extraStoryCentsPerSquare: cents,
  tearOffCentsPerSquarePerLayer: cents,
  /** Decking replaced, per sheet, labor and material together. */
  deckSheetCents: cents,
});

export const addonSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  driver: z.enum(driverKeys),
  unitLabel: z.string().trim().min(1).max(20),
  /** Material and labor together, per unit. */
  costCentsPerUnit: cents,
  active: z.boolean().default(true),
});
export type Addon = z.infer<typeof addonSchema>;

export const catalogSchema = z.object({
  materials: z.array(materialSchema),
  systems: z.array(systemSchema),
  labor: laborSchema,
  addons: z.array(addonSchema),
  jobCosts: z.object({ dumpsterCents: cents, permitCents: cents }),
  defaultMarginPct: z.number().min(0).max(90),
}).superRefine((c, ctx) => {
  const ids = new Set(c.materials.map((m) => m.id));
  if (ids.size !== c.materials.length) ctx.addIssue({ code: "custom", message: "Two materials share an id." });
  for (const s of c.systems) {
    for (const m of s.materialIds) {
      if (!ids.has(m)) ctx.addIssue({ code: "custom", message: `${s.name} uses a material that is not in the list.` });
    }
  }
});
export type Catalog = z.infer<typeof catalogSchema>;

/**
 * Starting price list. Every number here is a PLACEHOLDER until Andrey sends
 * his supplier sheet and crew rates; the catalog is published with
 * needs_confirmation, and every estimate built on it says so.
 */
export const PLACEHOLDER_CATALOG: Catalog = {
  materials: [
    { id: "gaf-hdz", name: "GAF Timberline HDZ shingles", unit: "bundle", costCents: 4000, coverage: 1 / 3, driver: "squares", wastePct: 10 },
    { id: "gaf-uhdz", name: "GAF Timberline UHDZ shingles", unit: "bundle", costCents: 4600, coverage: 1 / 3, driver: "squares", wastePct: 10 },
    { id: "gaf-sequoia", name: "GAF Grand Sequoia shingles", unit: "bundle", costCents: 5200, coverage: 0.25, driver: "squares", wastePct: 10 },
    { id: "gaf-starter", name: "GAF Pro-Start starter strip", unit: "bundle", costCents: 5500, coverage: 120, driver: "eaves_rakes", wastePct: 5 },
    { id: "gaf-ridge", name: "GAF Seal-A-Ridge ridge cap", unit: "bundle", costCents: 7000, coverage: 25, driver: "ridges_hips", wastePct: 5 },
    { id: "gaf-underlayment", name: "GAF FeltBuster synthetic underlayment", unit: "roll", costCents: 12000, coverage: 10, driver: "squares", wastePct: 10 },
    { id: "gaf-ice-water", name: "GAF WeatherWatch ice & water shield", unit: "roll", costCents: 9500, coverage: 65, driver: "eaves_valleys", wastePct: 5 },
    { id: "drip-edge", name: "Drip edge (10 ft)", unit: "piece", costCents: 900, coverage: 10, driver: "eaves_rakes", wastePct: 5 },
    { id: "coil-nails", name: "Coil roofing nails", unit: "box", costCents: 4500, coverage: 15, driver: "squares", wastePct: 0 },
    { id: "pipe-boot", name: "Pipe boot", unit: "each", costCents: 1500, coverage: 1, driver: "pipe_boots", wastePct: 0 },
    { id: "step-flashing", name: "Step flashing (100 pcs)", unit: "bundle", costCents: 4500, coverage: 50, driver: "step_flashing", wastePct: 0 },
    { id: "ridge-vent", name: "Cobra ridge vent (4 ft)", unit: "piece", costCents: 1400, coverage: 4, driver: "ridges", wastePct: 0 },
  ],
  systems: [
    {
      id: "gaf-good", name: "GAF Timberline HDZ", brand: "GAF", tier: "good", active: true,
      materialIds: ["gaf-hdz", "gaf-starter", "gaf-ridge", "gaf-underlayment", "gaf-ice-water", "drip-edge", "coil-nails", "pipe-boot", "step-flashing", "ridge-vent"],
      laborAdjustCentsPerSquare: 0, marginPct: null,
      warranty: "[Placeholder: paste the GAF Timberline HDZ warranty language from the Roofr template.]",
    },
    {
      id: "gaf-better", name: "GAF Timberline UHDZ", brand: "GAF", tier: "better", active: true,
      materialIds: ["gaf-uhdz", "gaf-starter", "gaf-ridge", "gaf-underlayment", "gaf-ice-water", "drip-edge", "coil-nails", "pipe-boot", "step-flashing", "ridge-vent"],
      laborAdjustCentsPerSquare: 0, marginPct: null,
      warranty: "[Placeholder: paste the GAF Timberline UHDZ warranty language from the Roofr template.]",
    },
    {
      id: "gaf-best", name: "GAF Grand Sequoia", brand: "GAF", tier: "best", active: true,
      materialIds: ["gaf-sequoia", "gaf-starter", "gaf-ridge", "gaf-underlayment", "gaf-ice-water", "drip-edge", "coil-nails", "pipe-boot", "step-flashing", "ridge-vent"],
      laborAdjustCentsPerSquare: 1500, marginPct: null,
      warranty: "[Placeholder: paste the GAF Grand Sequoia warranty language from the Roofr template.]",
    },
  ],
  labor: {
    pitchBands: [
      { maxPitch: 7, centsPerSquare: 9000 },
      { maxPitch: 9, centsPerSquare: 11000 },
      { maxPitch: 12, centsPerSquare: 13500 },
      { maxPitch: 30, centsPerSquare: 17500 },
    ],
    extraStoryCentsPerSquare: 1000,
    tearOffCentsPerSquarePerLayer: 2000,
    deckSheetCents: 8500,
  },
  addons: [
    { id: "gutters", name: "Seamless gutters", driver: "eaves", unitLabel: "ft", costCentsPerUnit: 550, active: true },
    { id: "skylight-reflash", name: "Skylight reflash", driver: "skylights", unitLabel: "each", costCentsPerUnit: 15000, active: true },
    { id: "chimney-flashing", name: "Chimney flashing", driver: "chimneys", unitLabel: "each", costCentsPerUnit: 30000, active: true },
  ],
  jobCosts: { dumpsterCents: 25000, permitCents: 25000 },
  defaultMarginPct: 30,
};
