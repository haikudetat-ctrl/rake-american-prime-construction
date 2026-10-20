import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { saveEstimate } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { DRIVERS, TIER_LABEL } from "@/lib/estimate/catalog";
import { defaultAddonQty, type EstimateInputs } from "@/lib/estimate/price";
import { activeCatalog, toRoofMeasurements } from "@/lib/estimate/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function EstimatePage({ params, searchParams }: PageProps<"/office/leads/[id]/estimate">) {
  const member = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: lead } = await supabase.from("leads").select("id, name, address").eq("id", id).maybeSingle();
  if (!lead) notFound();

  const proposalId = typeof query.p === "string" ? query.p : null;
  const { data: proposal } = proposalId
    ? await supabase.from("proposals").select("id, number, status, inputs, measurement_id").eq("id", proposalId).eq("lead_id", id).maybeSingle()
    : { data: null };
  const measurementId = typeof query.m === "string" ? query.m : proposal?.measurement_id;
  const { data: row } = measurementId
    ? await supabase.from("measurements").select("*").eq("id", measurementId).eq("lead_id", id).maybeSingle()
    : await supabase.from("measurements").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) redirect(`/office/leads/${id}/measure`);

  const m = toRoofMeasurements(row);
  const catalog = await activeCatalog(member.companyId);
  const prior = proposal?.inputs as EstimateInputs | undefined;
  const systems = catalog.data.systems.filter((s) => s.active || prior?.systemIds.includes(s.id));
  const chosen = new Set(prior?.systemIds ?? systems.filter((s) => s.active).slice(0, 3).map((s) => s.id));

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href={`/office/leads/${id}`}>← {lead.name}</Link></p>
      <h1 className="text-xl font-semibold">{proposal ? `Re-price estimate #${proposal.number}` : "New estimate"}</h1>
      {catalog.needsConfirmation && (
        <p className="card border-warn/40 bg-warn/10 text-sm">
          The roofing price list still has placeholder numbers. Estimates are marked as drafts until an owner confirms prices.
        </p>
      )}
      <section className="card text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p>
            <strong>{m.squares} squares</strong>, {m.pitch}/12 pitch, {m.stories} {m.stories === 1 ? "story" : "stories"},{" "}
            {m.layers} layer{m.layers === 1 ? "" : "s"} · eaves {m.eaves} ft, rakes {m.rakes} ft, ridges {m.ridges} ft, hips {m.hips} ft,
            valleys {m.valleys} ft · {m.deck_sheets} deck sheets, {m.pipe_boots} pipe boots, {m.skylights} skylights
          </p>
          <Link className="underline" href={`/office/leads/${id}/measure?m=${row.id}`}>Edit measurements</Link>
        </div>
      </section>

      <form action={saveEstimate} className="space-y-4">
        <input type="hidden" name="leadId" value={id} />
        <input type="hidden" name="measurementId" value={row.id} />
        {proposal?.status === "draft" && <input type="hidden" name="proposalId" value={proposal.id} />}

        <section className="card space-y-2">
          <h2 className="font-semibold">Options to offer (up to 3)</h2>
          {systems.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="systemId" value={s.id} defaultChecked={chosen.has(s.id)} />
              <span>{s.name}</span>
              <span className="pill">{TIER_LABEL[s.tier]}</span>
              <span className="text-muted">{s.brand}</span>
            </label>
          ))}
        </section>

        <section className="card space-y-2">
          <h2 className="font-semibold">Add-ons</h2>
          {catalog.data.addons.filter((a) => a.active).map((a) => {
            const suggested = defaultAddonQty(m, a.driver);
            const qty = prior?.addons[a.id] ?? suggested;
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name={`use_${a.id}`} defaultChecked={prior ? a.id in prior.addons : false} />
                  {a.name}
                </label>
                <input name={`addon_${a.id}`} type="number" min={0} step="0.5" defaultValue={qty} className="input w-24" />
                <span className="text-muted">{a.unitLabel}{a.driver !== "job" && ` (measured: ${suggested} from ${DRIVERS[a.driver].label.toLowerCase()})`}</span>
              </div>
            );
          })}
        </section>

        <section className="card flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includeDumpster" defaultChecked={prior?.includeDumpster ?? true} /> Dumpster
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includePermit" defaultChecked={prior?.includePermit ?? true} /> Permit
          </label>
        </section>
        <button className="btn">{proposal ? "Re-price" : "Price it"}</button>
      </form>
    </>
  );
}
