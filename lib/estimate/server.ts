import "server-only";
import { catalogSchema, MEASURES, PLACEHOLDER_CATALOG, type Catalog } from "@/lib/estimate/catalog";
import { priceEstimate, type EstimateInputs, type RoofMeasurements } from "@/lib/estimate/price";
import { adminClient } from "@/lib/supabase/admin";

export type ActiveCatalog = { id: string; version: number; needsConfirmation: boolean; data: Catalog };

/**
 * The company's current price list, read with the service role (office staff
 * price estimates but can't read supplier costs). Seeds the placeholder list
 * the first time.
 */
export async function activeCatalog(companyId: string): Promise<ActiveCatalog> {
  const db = adminClient();
  let { data: row } = await db
    .from("catalog_versions")
    .select("id, version, needs_confirmation, data")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (!row) {
    const { error } = await db.rpc("seed_catalog", { p_company_id: companyId, p_data: PLACEHOLDER_CATALOG });
    if (error) throw new Error(error.message);
    ({ data: row } = await db
      .from("catalog_versions")
      .select("id, version, needs_confirmation, data")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .single());
  }
  const parsed = catalogSchema.safeParse(row!.data);
  if (!parsed.success) throw new Error(`Price list version ${row!.version} is damaged: ${parsed.error.issues[0]?.message}`);
  return { id: row!.id, version: row!.version, needsConfirmation: row!.needs_confirmation, data: parsed.data };
}

export const MEASUREMENT_COLUMNS = ["pitch", "stories", "layers", ...MEASURES] as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- a measurements row */
export function toRoofMeasurements(row: any): RoofMeasurements {
  const out = {} as RoofMeasurements;
  for (const key of MEASUREMENT_COLUMNS) out[key] = Number(row?.[key] ?? 0) || 0;
  if (!out.stories) out.stories = 1;
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Prices a proposal on the server from the stored measurement and the active
 * price list, then saves it (new, or re-priced draft). Callers check that the
 * member is staff; the database checks the lead and draft status.
 */
export async function priceAndSaveProposal(p: {
  companyId: string;
  actorId: string;
  leadId: string;
  proposalId: string | null;
  measurementId: string;
  inputs: EstimateInputs;
}): Promise<string> {
  const db = adminClient();
  const { data: row, error: mError } = await db
    .from("measurements")
    .select("*")
    .eq("id", p.measurementId)
    .eq("company_id", p.companyId)
    .eq("lead_id", p.leadId)
    .single();
  if (mError || !row) throw new Error("Those measurements are not on this lead.");
  const measurement = toRoofMeasurements(row);
  const catalog = await activeCatalog(p.companyId);
  const estimate = priceEstimate(catalog.data, measurement, p.inputs);
  if (estimate.options.length === 0) throw new Error("Choose at least one roof system.");

  const { data: id, error } = await db.rpc("save_proposal", {
    p_company_id: p.companyId,
    p_actor: p.actorId,
    p_lead_id: p.leadId,
    p_proposal_id: p.proposalId,
    p_catalog_version_id: catalog.id,
    p_measurement_id: p.measurementId,
    p_measurement: measurement,
    p_inputs: p.inputs,
    p_options: estimate.options.map(({ systemId, name, brand, tier, tierLabel, warranty, priceCents }) =>
      ({ systemId, name, brand, tier, tierLabel, warranty, priceCents })),
    p_addons: estimate.addons.map(({ addonId, name, qty, unitLabel, priceCents }) => ({ addonId, name, qty, unitLabel, priceCents })),
    p_warnings: estimate.warnings,
    p_costs: {
      catalogVersion: catalog.version,
      options: estimate.options.map(({ systemId, costCents, marginPct, priceCents, lines }) => ({ systemId, costCents, marginPct, priceCents, lines })),
      addons: estimate.addons.map(({ addonId, costCents, priceCents }) => ({ addonId, costCents, priceCents })),
    },
  });
  if (error) throw new Error(error.message);
  return id as string;
}
