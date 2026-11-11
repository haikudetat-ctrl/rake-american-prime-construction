import { Unavailable } from "../../_unavailable";
import Link from "next/link";
import { addSubWorker, saveSubContractor, saveSubPriceItem, saveSubSettings, setSubPriceItemActive, setSubWorkerActive } from "@/app/office/subs/actions";
import { rateText } from "@/app/office/subs/_parts";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { formatPitchTiers, readTiers, UNIT_LABEL, UNITS, type PitchTier } from "@/lib/subcontract/tiers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Contractor = {
  id: string;
  name: string;
  billing_email: string | null;
  phone: string | null;
  payment_terms_days: number;
  cents_per_sq: number;
  pitch_tiers: unknown;
  min_job_cents: number | null;
  notes: string | null;
  is_active: boolean;
};

type PriceItem = {
  id: string;
  contractor_id: string;
  description: string;
  unit: keyof typeof UNIT_LABEL;
  bill_unit_cents: number;
  pay_unit_cents: number;
  is_active: boolean;
};

const TIER_HINT = "From each pitch on, the extra per square. 9: 15, 11: 20 is +$15 at 9/12 and 10/12, +$20 from 11/12. Blank for none.";

const dollars = (cents: number) => (cents / 100).toFixed(2);

function ContractorFields({ c }: { c?: Contractor }) {
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="label sm:col-span-1"><span>Name</span><input name="name" required defaultValue={c?.name} className="input" /></label>
        <label className="label"><span>Billing email</span><input name="billingEmail" type="email" defaultValue={c?.billing_email ?? ""} className="input" /></label>
        <label className="label"><span>Phone</span><input name="phone" type="tel" defaultValue={c?.phone ?? ""} className="input" /></label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="label"><span>Pays $/sq</span>
          <input name="rate" required inputMode="decimal" defaultValue={c ? dollars(c.cents_per_sq) : ""} placeholder="120" className="input" />
        </label>
        <label className="label sm:col-span-2"><span>Pitch extras (pitch: $/sq)</span>
          <input name="pitchTiers" defaultValue={c ? formatPitchTiers(readTiers(c.pitch_tiers)) : ""} placeholder="9: 15, 11: 20" className="input" aria-describedby="tier-hint" />
        </label>
        <label className="label"><span>Minimum a roof ($)</span>
          <input name="minimum" inputMode="decimal" defaultValue={c?.min_job_cents ? dollars(c.min_job_cents) : ""} placeholder="None" className="input" />
        </label>
        <label className="label"><span>Pays within (days)</span>
          <input name="terms" inputMode="numeric" defaultValue={c?.payment_terms_days ?? 14} className="input" />
        </label>
      </div>
      <p id="tier-hint" className="text-xs text-muted">{TIER_HINT} The minimum applies to jobs with squares, and prints as its own line on the invoice.</p>
      <label className="label"><span>Notes</span><input name="notes" defaultValue={c?.notes ?? ""} className="input" /></label>
    </>
  );
}

/** A contractor's price list: what they pay and what the crew gets, per foot, each, per sheet... */
function PriceList({ contractorId, items }: { contractorId: string; items: PriceItem[] }) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">Price list</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. Gutters by the foot, miters each, anything they pay a set price for.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Item</th><th className="text-right">They pay</th><th className="text-right">Crew gets</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={item.is_active ? "" : "opacity-60"}>
                <td>{item.description}</td>
                <td className="text-right">{formatCents(item.bill_unit_cents)} {UNIT_LABEL[item.unit]}</td>
                <td className="text-right">{formatCents(item.pay_unit_cents)} {UNIT_LABEL[item.unit]}</td>
                <td className="w-px">
                  <form action={setSubPriceItemActive}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="active" value={item.is_active ? "false" : "true"} />
                    <button className="text-xs underline">{item.is_active ? "remove" : "put back"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={saveSubPriceItem} className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end">
        <input type="hidden" name="contractorId" value={contractorId} />
        <label className="label col-span-2"><span>Item</span><input name="description" required placeholder={'5" K-style gutter'} className="input" /></label>
        <label className="label"><span>Counted</span>
          <select name="unit" defaultValue="ft" className="input">
            {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
          </select>
        </label>
        <label className="label"><span>They pay $</span><input name="bill" required inputMode="decimal" placeholder="6.50" className="input" /></label>
        <label className="label"><span>Crew gets $</span><input name="pay" inputMode="decimal" placeholder="5.50" className="input" /></label>
        <button className="btn-secondary col-span-2 sm:col-span-5 sm:justify-self-start">Save item</button>
      </form>
      <p className="text-xs text-muted">Saving an item with the same name updates its prices. Jobs that already have it keep the price they got.</p>
    </div>
  );
}

/** The contractors he subs for (their rate sheets), his crew, and what the crew gets paid. */
export default async function SubsSetupPage({ searchParams }: PageProps<"/office/subs/setup">) {
  await requireStaff();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: contractors, error: contractorError }, { data: workers, error: workerError }, { data: settings, error: settingsError }, { data: priceItems, error: priceError }] = await Promise.all([
    supabase.from("sub_contractors").select("*").order("is_active", { ascending: false }).order("name"),
    supabase.from("sub_workers").select("id, name, phone, is_active").order("is_active", { ascending: false }).order("name"),
    supabase.from("sub_settings").select("*").maybeSingle(),
    supabase.from("sub_price_items").select("id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents, is_active")
      .order("is_active", { ascending: false }).order("description"),
  ]);
  if (contractorError || workerError || settingsError || priceError) return <Unavailable area="Subcontracting setup" />;
  // Same default as the database when no crew rates were ever saved: $5 a step from 9/12.
  const defaultCrewTiers: PitchTier[] = Array.from({ length: 16 }, (_, i) => ({ from: 9 + i, cents: 500 * (i + 1) }));
  const crew = {
    base: settings?.crew_cents_per_sq ?? 5000,
    tiers: settings ? readTiers(settings.crew_pitch_tiers) : defaultCrewTiers,
  };
  const itemsFor = (id: string) => ((priceItems ?? []) as PriceItem[]).filter((i) => i.contractor_id === id);

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/subs">← Subcontracting</Link></p>
      <h1 className="page-title">Subcontracting setup</h1>
      <p className="text-sm text-muted">
        Pitch extras are tiers: &ldquo;9: 15, 11: 20&rdquo; is +$15 a square at 9/12 and 10/12, +$20 from 11/12 up.
        Rate changes apply to jobs closed from then on; closed jobs keep the rates they closed at.
      </p>

      <section className="card space-y-3">
        <h2 className="font-semibold">What the crew gets</h2>
        <p className="text-sm text-muted">Now: {rateText(crew.base, crew.tiers)}, split evenly among whoever worked the job.</p>
        <form action={saveSubSettings} className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:items-end">
          <label className="label"><span>Crew $/sq</span>
            <input name="crewRate" required inputMode="decimal" defaultValue={dollars(crew.base)} className="input" />
          </label>
          <label className="label col-span-2"><span>Pitch extras (pitch: $/sq)</span>
            <input name="crewPitchTiers" defaultValue={formatPitchTiers(crew.tiers)} placeholder="9: 5, 11: 10" className="input" />
          </label>
          <button className="btn-secondary">Save crew rates</button>
        </form>
        <p className="text-xs text-muted">{TIER_HINT}</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Contractors you work for</h2>
        {(contractors ?? []).length === 0 && <p className="text-sm text-muted">None yet. Add the contractors you work for below.</p>}
        <ul className="space-y-2">
          {((contractors ?? []) as Contractor[]).map((c) => (
            <li key={c.id}>
              <details className={`rounded-md border border-border p-3 ${c.is_active ? "" : "opacity-60"}`}>
                <summary className="cursor-pointer">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted"> · {rateText(c.cents_per_sq, readTiers(c.pitch_tiers), c.min_job_cents)} · {c.payment_terms_days} days
                    {c.billing_email ? ` · ${c.billing_email}` : " · no billing email"}{c.is_active ? "" : " · inactive"}</span>
                </summary>
                <form action={saveSubContractor} className="mt-3 space-y-2">
                  <ContractorFields c={c} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={c.is_active} /> Still working for them
                  </label>
                  <button className="btn-secondary">Save {c.name}</button>
                </form>
                <PriceList contractorId={c.id} items={itemsFor(c.id)} />
              </details>
            </li>
          ))}
        </ul>
        <details className="rounded-md border border-dashed border-border p-3" open={(contractors ?? []).length === 0}>
          <summary className="cursor-pointer font-medium">Add a contractor</summary>
          <form action={saveSubContractor} className="mt-3 space-y-2">
            <ContractorFields />
            <button className="btn-secondary">Add contractor</button>
          </form>
        </details>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Crew</h2>
        <ul className="divide-y divide-border">
          {(workers ?? []).map((w) => (
            <li key={w.id} className={`flex items-center justify-between gap-2 py-2 ${w.is_active ? "" : "opacity-60"}`}>
              <span>{w.name}{w.phone && <span className="text-sm text-muted"> · {w.phone}</span>}</span>
              <form action={setSubWorkerActive}>
                <input type="hidden" name="workerId" value={w.id} />
                <input type="hidden" name="active" value={w.is_active ? "false" : "true"} />
                <button className="text-sm underline">{w.is_active ? "Take off the list" : "Put back on the list"}</button>
              </form>
            </li>
          ))}
          {(workers ?? []).length === 0 && <li className="py-2 text-sm text-muted">No one yet.</li>}
        </ul>
        <form action={addSubWorker} className="flex flex-wrap items-end gap-2">
          <label className="label flex-1"><span>Name</span><input name="name" required placeholder="Baltimore" className="input" /></label>
          <label className="label"><span>Phone (optional)</span><input name="phone" type="tel" className="input" /></label>
          <button className="btn-secondary">Add to crew</button>
        </form>
      </section>
    </>
  );
}
