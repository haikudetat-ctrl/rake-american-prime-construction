import Link from "next/link";
import { savePriceList } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireOwner } from "@/lib/auth";
import { DRIVERS, TIERS, TIER_LABEL, type Driver } from "@/lib/estimate/catalog";
import { activeCatalog } from "@/lib/estimate/server";

const dollars = (cents: number) => (cents / 100).toFixed(2);
const coverageText = (n: number) => (Math.abs(n - 1 / 3) < 1e-9 ? "1/3" : String(Math.round(n * 10000) / 10000));
const BLANK_ROWS = 3;

function DriverSelect({ name, value }: { name: string; value?: Driver }) {
  return (
    <select name={name} className="input" defaultValue={value ?? "squares"}>
      {(Object.keys(DRIVERS) as Driver[]).map((d) => <option key={d} value={d}>{DRIVERS[d].label}</option>)}
    </select>
  );
}

/** Owner-only. The roofing price list: materials, systems, labor, add-ons, margin. Each save publishes a new version. */
export default async function PricingPage({ searchParams }: PageProps<"/office/pricing">) {
  const owner = await requireOwner();
  const query = await searchParams;
  const catalog = await activeCatalog(owner.companyId);
  const c = catalog.data;

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/settings">← Settings</Link></p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Roofing price list</h1>
        <span className="pill">version {catalog.version}</span>
      </div>
      <p className="text-sm text-muted">
        Only owners see this page. Office staff can build estimates but never see costs or margins. Each save publishes a
        new version; estimates already built keep the prices they were built with.
      </p>

      <form action={savePriceList} className={`card flex flex-wrap items-center gap-3 text-sm ${catalog.needsConfirmation ? "border-warn/40 bg-warn/10" : ""}`}>
        <input type="hidden" name="section" value="confirm" />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirmed" defaultChecked={!catalog.needsConfirmation} />
          These are real prices (not placeholders)
        </label>
        <button className="btn-secondary">Save</button>
        {catalog.needsConfirmation && <span className="text-warn">Placeholder prices: every estimate says so until this is ticked.</span>}
      </form>

      <section className="card space-y-3">
        <h2 className="font-semibold">Materials</h2>
        <p className="text-xs text-muted">
          Cost is what you pay per unit. &quot;Covers&quot; is how much of the measurement one unit covers: shingles 1/3 (square per
          bundle), starter 120 (ft per bundle). Waste is added before rounding up to whole units.
        </p>
        <form action={savePriceList} className="space-y-2">
          <input type="hidden" name="section" value="materials" />
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>Name</th><th>Unit</th><th>Cost ($)</th><th>Covers</th><th>Measured by</th><th>Waste %</th><th>Remove</th></tr></thead>
              <tbody>
                {[...c.materials, ...Array.from({ length: BLANK_ROWS }, () => null)].map((m, i) => (
                  <tr key={m?.id ?? `new-${i}`}>
                    <td>
                      <input type="hidden" name={`m_${i}_id`} value={m?.id ?? ""} />
                      <input name={`m_${i}_name`} defaultValue={m?.name ?? ""} placeholder={m ? "" : "New material"} className="input min-w-48" />
                    </td>
                    <td><input name={`m_${i}_unit`} defaultValue={m?.unit ?? ""} className="input w-20" /></td>
                    <td><input name={`m_${i}_cost`} defaultValue={m ? dollars(m.costCents) : ""} inputMode="decimal" className="input w-24" /></td>
                    <td><input name={`m_${i}_coverage`} defaultValue={m ? coverageText(m.coverage) : ""} className="input w-20" /></td>
                    <td><DriverSelect name={`m_${i}_driver`} value={m?.driver} /></td>
                    <td><input name={`m_${i}_waste`} defaultValue={m?.wastePct ?? 0} type="number" min={0} max={100} className="input w-16" /></td>
                    <td>{m && <input type="checkbox" name={`m_${i}_remove`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn">Save materials</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Roof systems (good / better / best)</h2>
        <form action={savePriceList} className="space-y-4">
          <input type="hidden" name="section" value="systems" />
          {[...c.systems, null].map((s, i) => (
            <fieldset key={s?.id ?? "new"} className="space-y-2 rounded-md border border-border p-3">
              <input type="hidden" name={`s_${i}_id`} value={s?.id ?? ""} />
              <div className="grid gap-2 sm:grid-cols-6 sm:items-end">
                <label className="label sm:col-span-2"><span>{s ? "Name" : "Add a system"}</span>
                  <input name={`s_${i}_name`} defaultValue={s?.name ?? ""} className="input" />
                </label>
                <label className="label"><span>Brand</span><input name={`s_${i}_brand`} defaultValue={s?.brand ?? "GAF"} className="input" /></label>
                <label className="label"><span>Tier</span>
                  <select name={`s_${i}_tier`} defaultValue={s?.tier ?? "good"} className="input">
                    {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="label"><span>Extra labor $/sq</span>
                  <input name={`s_${i}_labor`} defaultValue={s ? dollars(s.laborAdjustCentsPerSquare) : "0"} className="input" />
                </label>
                <label className="label"><span>Margin % (blank = default)</span>
                  <input name={`s_${i}_margin`} defaultValue={s?.marginPct ?? ""} className="input" />
                </label>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {c.materials.map((m) => (
                  <label key={m.id} className="flex items-center gap-1">
                    <input type="checkbox" name={`s_${i}_mat`} value={m.id} defaultChecked={s?.materialIds.includes(m.id) ?? false} /> {m.name}
                  </label>
                ))}
              </div>
              <label className="label"><span>Warranty text (prints on the proposal)</span>
                <textarea name={`s_${i}_warranty`} rows={2} defaultValue={s?.warranty ?? ""} className="input" />
              </label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="checkbox" name={`s_${i}_active`} defaultChecked={s?.active ?? true} /> Offered</label>
                {s && <label className="flex items-center gap-1"><input type="checkbox" name={`s_${i}_remove`} /> Remove</label>}
              </div>
            </fieldset>
          ))}
          <button className="btn">Save systems</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Labor, job costs and margin</h2>
        <form action={savePriceList} className="space-y-3">
          <input type="hidden" name="section" value="labor" />
          <div className="grid gap-2 sm:grid-cols-4">
            {[...c.labor.pitchBands, null].map((b, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <label className="label"><span>Up to pitch</span><input name={`b_${i}_max`} defaultValue={b?.maxPitch ?? ""} className="input" /></label>
                <label className="label"><span>$ per square</span><input name={`b_${i}_rate`} defaultValue={b ? dollars(b.centsPerSquare) : ""} className="input" /></label>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="label"><span>Extra per story, $/sq</span><input name="story" defaultValue={dollars(c.labor.extraStoryCentsPerSquare)} className="input" /></label>
            <label className="label"><span>Tear-off per layer, $/sq</span><input name="tearoff" defaultValue={dollars(c.labor.tearOffCentsPerSquarePerLayer)} className="input" /></label>
            <label className="label"><span>Decking per sheet, $ (labor + sheet)</span><input name="deck" defaultValue={dollars(c.labor.deckSheetCents)} className="input" /></label>
            <label className="label"><span>Dumpster per job, $ (your cost)</span><input name="dumpster" defaultValue={dollars(c.jobCosts.dumpsterCents)} className="input" /></label>
            <label className="label"><span>Permit per job, $</span><input name="permit" defaultValue={dollars(c.jobCosts.permitCents)} className="input" /></label>
            <label className="label"><span>Target margin %</span><input name="margin" defaultValue={c.defaultMarginPct} className="input" /></label>
          </div>
          <p className="text-xs text-muted">Price = cost ÷ (1 − margin), rounded up to the next $10.</p>
          <button className="btn">Save labor and margin</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Add-ons</h2>
        <form action={savePriceList} className="space-y-2">
          <input type="hidden" name="section" value="addons" />
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>Name</th><th>Measured by</th><th>Unit</th><th>Cost per unit ($, material + labor)</th><th>Offered</th><th>Remove</th></tr></thead>
              <tbody>
                {[...c.addons, ...Array.from({ length: 2 }, () => null)].map((a, i) => (
                  <tr key={a?.id ?? `new-${i}`}>
                    <td>
                      <input type="hidden" name={`a_${i}_id`} value={a?.id ?? ""} />
                      <input name={`a_${i}_name`} defaultValue={a?.name ?? ""} placeholder={a ? "" : "New add-on"} className="input min-w-40" />
                    </td>
                    <td><DriverSelect name={`a_${i}_driver`} value={a?.driver ?? "job"} /></td>
                    <td><input name={`a_${i}_unit`} defaultValue={a?.unitLabel ?? "each"} className="input w-16" /></td>
                    <td><input name={`a_${i}_cost`} defaultValue={a ? dollars(a.costCentsPerUnit) : ""} className="input w-24" /></td>
                    <td><input type="checkbox" name={`a_${i}_active`} defaultChecked={a?.active ?? true} /></td>
                    <td>{a && <input type="checkbox" name={`a_${i}_remove`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn">Save add-ons</button>
        </form>
      </section>
    </>
  );
}
