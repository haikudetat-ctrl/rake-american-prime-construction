import { Unavailable } from "../../_unavailable";
import Link from "next/link";
import { addSubWorker, saveSubContractor, saveSubSettings, setSubWorkerActive } from "@/app/office/subs/actions";
import { rateText } from "@/app/office/subs/_parts";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Contractor = {
  id: string;
  name: string;
  billing_email: string | null;
  phone: string | null;
  payment_terms_days: number;
  cents_per_sq: number;
  pitch_from: number;
  pitch_step_cents: number;
  notes: string | null;
  is_active: boolean;
};

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
          <input name="rate" required inputMode="decimal" defaultValue={c ? dollars(c.cents_per_sq) : ""} placeholder="95" className="input" />
        </label>
        <label className="label"><span>Pitch extra $/sq</span>
          <input name="pitchStep" inputMode="decimal" defaultValue={c ? dollars(c.pitch_step_cents) : "5.00"} className="input" />
        </label>
        <label className="label"><span>Extra starts at (x/12)</span>
          <input name="pitchFrom" inputMode="numeric" defaultValue={c?.pitch_from ?? 9} className="input" />
        </label>
        <label className="label"><span>Pays within (days)</span>
          <input name="terms" inputMode="numeric" defaultValue={c?.payment_terms_days ?? 14} className="input" />
        </label>
      </div>
      <label className="label"><span>Notes</span><input name="notes" defaultValue={c?.notes ?? ""} className="input" /></label>
    </>
  );
}

/** The contractors he subs for (their rate sheets), his crew, and what the crew gets paid. */
export default async function SubsSetupPage({ searchParams }: PageProps<"/office/subs/setup">) {
  await requireStaff();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: contractors, error: contractorError }, { data: workers, error: workerError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("sub_contractors").select("*").order("is_active", { ascending: false }).order("name"),
    supabase.from("sub_workers").select("id, name, phone, is_active").order("is_active", { ascending: false }).order("name"),
    supabase.from("sub_settings").select("*").maybeSingle(),
  ]);
  if (contractorError || workerError || settingsError) return <Unavailable area="Subcontracting setup" />;
  const crew = {
    base: settings?.crew_cents_per_sq ?? 5000,
    from: settings?.crew_pitch_from ?? 9,
    step: settings?.crew_pitch_step_cents ?? 500,
  };

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/subs">← Subcontracting</Link></p>
      <h1 className="page-title">Subcontracting setup</h1>
      <p className="text-sm text-muted">
        A pitch extra of $5.00 starting at 9/12 means +$5 a square at 9/12, +$10 at 10/12, +$20 at 12/12.
        Rate changes apply to jobs closed from then on; closed jobs keep the rates they closed at.
      </p>

      <section className="card space-y-3">
        <h2 className="font-semibold">What the crew gets</h2>
        <p className="text-sm text-muted">Now: {rateText(crew.base, crew.from, crew.step)}, split evenly among whoever worked the job.</p>
        <form action={saveSubSettings} className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:items-end">
          <label className="label"><span>Crew $/sq</span>
            <input name="crewRate" required inputMode="decimal" defaultValue={dollars(crew.base)} className="input" />
          </label>
          <label className="label"><span>Pitch extra $/sq</span>
            <input name="crewPitchStep" inputMode="decimal" defaultValue={dollars(crew.step)} className="input" />
          </label>
          <label className="label"><span>Extra starts at (x/12)</span>
            <input name="crewPitchFrom" inputMode="numeric" defaultValue={crew.from} className="input" />
          </label>
          <button className="btn-secondary">Save crew rates</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Contractors you work for</h2>
        {(contractors ?? []).length === 0 && <p className="text-sm text-muted">None yet. Add All Season, Rampage and the rest below.</p>}
        <ul className="space-y-2">
          {((contractors ?? []) as Contractor[]).map((c) => (
            <li key={c.id}>
              <details className={`rounded-md border border-border p-3 ${c.is_active ? "" : "opacity-60"}`}>
                <summary className="cursor-pointer">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted"> · {rateText(c.cents_per_sq, c.pitch_from, c.pitch_step_cents)} · {c.payment_terms_days} days
                    {c.billing_email ? ` · ${c.billing_email}` : " · no billing email"}{c.is_active ? "" : " · inactive"}</span>
                </summary>
                <form action={saveSubContractor} className="mt-3 space-y-2">
                  <ContractorFields c={c} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={c.is_active} /> Still working for them
                  </label>
                  <button className="btn-secondary">Save {c.name}</button>
                </form>
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
