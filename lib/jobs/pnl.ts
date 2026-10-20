// A roofing job's profit and loss, and how it compares with the estimate.
// Pure, so the arithmetic is unit-tested.

export const COST_KINDS = ["crew", "materials", "stock", "dumpster", "gutters", "permit", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const COST_LABEL: Record<CostKind, string> = {
  crew: "Crew",
  materials: "Supplier materials",
  stock: "Stock from the shelf",
  dumpster: "Our dumpster",
  gutters: "Our gutters",
  permit: "Permit",
  other: "Other",
};

/** Lines compared against the estimate: shelf stock and supplier bills are both "materials". */
export type CompareKey = "materials" | "crew" | "dumpster" | "gutters" | "permit" | "other";
const COMPARE_OF: Record<CostKind, CompareKey> = {
  crew: "crew", materials: "materials", stock: "materials", dumpster: "dumpster", gutters: "gutters", permit: "permit", other: "other",
};
export const COMPARE_LABEL: Record<CompareKey, string> = {
  materials: "Materials", crew: "Labor / crew", dumpster: "Dumpster", gutters: "Gutters", permit: "Permit", other: "Other",
};

export type JobCost = { kind: CostKind; amountCents: number; voided: boolean };
export type EstimateLine = { kind: "material" | "labor" | "job"; name: string; totalCents: number };
export type EstimateAddon = { addonId: string; costCents: number };

export type Pnl = {
  contractCents: number;
  paidCents: number;
  owedCents: number;
  costCents: number;
  profitCents: number;
  marginPct: number | null;
  byKind: Record<CostKind, number>;
  compare: { key: CompareKey; plannedCents: number | null; actualCents: number }[];
};

/** Where an estimate line belongs when comparing with actual costs. */
export function plannedKey(line: EstimateLine): CompareKey {
  if (line.kind === "material") return "materials";
  if (line.kind === "labor") return "crew";
  if (/dumpster/i.test(line.name)) return "dumpster";
  if (/permit/i.test(line.name)) return "permit";
  return "other";
}

export function jobPnl(p: {
  contractCents: number;
  payments: { amountCents: number; voided: boolean }[];
  costs: JobCost[];
  /** The estimate's build-up for the option that was signed, when the viewer may see it. */
  planned?: { lines: EstimateLine[]; addons: EstimateAddon[] } | null;
}): Pnl {
  const byKind = Object.fromEntries(COST_KINDS.map((k) => [k, 0])) as Record<CostKind, number>;
  for (const c of p.costs) if (!c.voided) byKind[c.kind] += c.amountCents;
  const costCents = Object.values(byKind).reduce((s, n) => s + n, 0);
  const paidCents = p.payments.filter((x) => !x.voided).reduce((s, x) => s + x.amountCents, 0);
  const profitCents = p.contractCents - costCents;

  const actual: Record<CompareKey, number> = { materials: 0, crew: 0, dumpster: 0, gutters: 0, permit: 0, other: 0 };
  for (const k of COST_KINDS) actual[COMPARE_OF[k]] += byKind[k];
  let planned: Record<CompareKey, number> | null = null;
  if (p.planned) {
    planned = { materials: 0, crew: 0, dumpster: 0, gutters: 0, permit: 0, other: 0 };
    for (const line of p.planned.lines) planned[plannedKey(line)] += line.totalCents;
    for (const a of p.planned.addons) planned[a.addonId === "gutters" ? "gutters" : "other"] += a.costCents;
  }
  const compare = (Object.keys(actual) as CompareKey[])
    .map((key) => ({ key, plannedCents: planned ? planned[key] : null, actualCents: actual[key] }))
    .filter((row) => row.actualCents !== 0 || (row.plannedCents ?? 0) !== 0);

  return {
    contractCents: p.contractCents,
    paidCents,
    owedCents: p.contractCents - paidCents,
    costCents,
    profitCents,
    marginPct: p.contractCents > 0 ? Math.round((profitCents / p.contractCents) * 1000) / 10 : null,
    byKind,
    compare,
  };
}
