import { saveCostSettings } from "@/app/office/actions";
import { adminClient } from "@/lib/supabase/admin";

/** Owner-only. What our own dumpsters and gutters really cost, charged to roofing jobs. */
export async function EquipmentCostCard({ companyId }: { companyId: string }) {
  const { data } = await adminClient().from("cost_settings").select("*").eq("company_id", companyId).maybeSingle();
  const dumpster = ((data?.own_dumpster_cents ?? 25000) / 100).toFixed(2);
  const gutter = ((data?.own_gutter_cents_per_ft ?? 250) / 100).toFixed(2);
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Job costing: our own equipment</h2>
      <p className="text-sm text-muted">
        Charged to a roofing job when you tap &quot;Charge&quot; on its page, so each job shows what using our own dumpster and
        gutters really cost. Starting values are the ones from our first call{data ? "" : " (not confirmed yet)"}.
      </p>
      <form action={saveCostSettings} className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <label className="label"><span>Our dumpster, per job ($)</span><input name="dumpster" defaultValue={dumpster} inputMode="decimal" className="input" /></label>
        <label className="label"><span>Our gutters, per foot ($)</span><input name="gutter" defaultValue={gutter} inputMode="decimal" className="input" /></label>
        <button className="btn sm:justify-self-start">Save</button>
      </form>
    </section>
  );
}
