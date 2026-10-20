import { DRIVERS, TIERS, type Catalog, type Driver } from "@/lib/estimate/catalog";

// Turning the price list editor's form fields back into a price list. Pure,
// so the parsing (dollars, fractions, removed rows) is unit-tested.

const s = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** "$1,234.50" → 123450; blank or junk → null. */
export function dollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** "1/3" or "0.333" or "120" → number; blank or junk → null. */
export function parseAmount(text: string): number | null {
  const t = text.trim();
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "item";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const rowIndexes = (form: FormData, prefix: string) =>
  [...new Set([...form.keys()].map((k) => new RegExp(`^${prefix}_(\\d+)_`).exec(k)?.[1]).filter(Boolean) as string[])]
    .map(Number)
    .sort((a, b) => a - b);

const isDriver = (d: string): d is Driver => d in DRIVERS;

export class PriceListFormError extends Error {}

/** Applies one edited section to the current price list. Throws PriceListFormError with a readable message. */
export function applySection(current: Catalog, section: string, form: FormData): Catalog {
  const next: Catalog = structuredClone(current);

  if (section === "materials") {
    const taken = new Set<string>();
    next.materials = [];
    for (const i of rowIndexes(form, "m")) {
      const name = s(form, `m_${i}_name`);
      if (!name || form.get(`m_${i}_remove`) === "on") continue;
      const cost = dollarsToCents(s(form, `m_${i}_cost`));
      const coverage = parseAmount(s(form, `m_${i}_coverage`));
      const driver = s(form, `m_${i}_driver`);
      if (cost === null || cost < 0) throw new PriceListFormError(`${name}: enter a cost in dollars.`);
      if (!coverage || coverage <= 0) throw new PriceListFormError(`${name}: enter how much one unit covers (e.g. 1/3 or 120).`);
      if (!isDriver(driver)) throw new PriceListFormError(`${name}: choose what it's measured by.`);
      const existing = s(form, `m_${i}_id`);
      const id = existing && !taken.has(existing) ? (taken.add(existing), existing) : slug(name, taken);
      next.materials.push({
        id, name, unit: s(form, `m_${i}_unit`) || "each", costCents: cost, coverage, driver,
        wastePct: Number(s(form, `m_${i}_waste`)) || 0,
      });
    }
  } else if (section === "systems") {
    const taken = new Set(current.systems.map((x) => x.id));
    next.systems = [];
    for (const i of rowIndexes(form, "s")) {
      const name = s(form, `s_${i}_name`);
      if (!name || form.get(`s_${i}_remove`) === "on") continue;
      const tier = s(form, `s_${i}_tier`);
      if (!(TIERS as readonly string[]).includes(tier)) throw new PriceListFormError(`${name}: choose good, better or best.`);
      const materialIds = form.getAll(`s_${i}_mat`).map(String);
      if (materialIds.length === 0) throw new PriceListFormError(`${name}: tick at least one material.`);
      const margin = s(form, `s_${i}_margin`);
      const existing = s(form, `s_${i}_id`);
      next.systems.push({
        id: existing || slug(name, taken),
        name,
        brand: s(form, `s_${i}_brand`) || "GAF",
        tier: tier as Catalog["systems"][number]["tier"],
        active: form.get(`s_${i}_active`) === "on",
        materialIds,
        laborAdjustCentsPerSquare: dollarsToCents(s(form, `s_${i}_labor`) || "0") ?? 0,
        marginPct: margin === "" ? null : Number(margin),
        warranty: s(form, `s_${i}_warranty`),
      });
    }
  } else if (section === "labor") {
    const bands = rowIndexes(form, "b")
      .map((i) => ({ maxPitch: parseAmount(s(form, `b_${i}_max`)), centsPerSquare: dollarsToCents(s(form, `b_${i}_rate`)) }))
      .filter((b): b is { maxPitch: number; centsPerSquare: number } => b.maxPitch !== null && b.centsPerSquare !== null);
    if (bands.length === 0) throw new PriceListFormError("Enter at least one labor rate by pitch.");
    const money = (key: string, label: string) => {
      const v = dollarsToCents(s(form, key));
      if (v === null || v < 0) throw new PriceListFormError(`Enter ${label} in dollars.`);
      return v;
    };
    next.labor = {
      pitchBands: bands.sort((a, b) => a.maxPitch - b.maxPitch),
      extraStoryCentsPerSquare: money("story", "the extra per story"),
      tearOffCentsPerSquarePerLayer: money("tearoff", "the tear-off rate"),
      deckSheetCents: money("deck", "the decking rate"),
    };
    next.jobCosts = { dumpsterCents: money("dumpster", "the dumpster cost"), permitCents: money("permit", "the permit cost") };
    const margin = Number(s(form, "margin"));
    if (!(margin >= 0 && margin < 90)) throw new PriceListFormError("Margin must be between 0 and 90%.");
    next.defaultMarginPct = margin;
  } else if (section === "addons") {
    const taken = new Set<string>();
    next.addons = [];
    for (const i of rowIndexes(form, "a")) {
      const name = s(form, `a_${i}_name`);
      if (!name || form.get(`a_${i}_remove`) === "on") continue;
      const cost = dollarsToCents(s(form, `a_${i}_cost`));
      const driver = s(form, `a_${i}_driver`);
      if (cost === null || cost < 0) throw new PriceListFormError(`${name}: enter a cost per unit.`);
      if (!isDriver(driver)) throw new PriceListFormError(`${name}: choose what it's measured by.`);
      const existing = s(form, `a_${i}_id`);
      next.addons.push({
        id: existing && !taken.has(existing) ? (taken.add(existing), existing) : slug(name, taken),
        name, driver, unitLabel: s(form, `a_${i}_unit`) || "each", costCentsPerUnit: cost,
        active: form.get(`a_${i}_active`) === "on",
      });
    }
  } else {
    throw new PriceListFormError("Unknown section.");
  }
  return next;
}
