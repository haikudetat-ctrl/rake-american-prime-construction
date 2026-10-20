import Link from "next/link";
import { notFound } from "next/navigation";
import { addJobCost, addOwnEquipment, pullStock, recordJobPayment, voidJobCost, voidJobPayment } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import type { CostLine } from "@/lib/estimate/price";
import { COMPARE_LABEL, COST_LABEL, jobPnl, type CostKind } from "@/lib/jobs/pnl";
import { formatCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const METHODS = ["check", "ach", "card", "cash", "financing", "other"] as const;
const signed = (cents: number) => (cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents));

/** One roofing job's profit and loss: payments in, costs out, against the estimate. */
export default async function JobPage({ params, searchParams }: PageProps<"/office/jobs/[id]">) {
  const member = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase.from("roofing_jobs").select("*").eq("id", id).maybeSingle();
  if (!job) notFound();

  const [{ data: costs }, { data: payments }, { data: items }, { data: signature }, { data: plannedRow }] = await Promise.all([
    supabase.from("job_costs").select("*").eq("job_id", id).order("created_at"),
    supabase.from("job_payments").select("*").eq("job_id", id).order("received_on"),
    supabase.from("stock_items").select("id, name, unit, on_hand, avg_cost_cents").eq("is_active", true).order("name"),
    supabase.from("proposal_signatures").select("system_id, addons").eq("proposal_id", job.proposal_id).maybeSingle(),
    // Owners only (RLS): the estimate's cost build-up.
    supabase.from("proposal_costs").select("breakdown").eq("proposal_id", job.proposal_id).maybeSingle(),
  ]);
  const breakdown = plannedRow?.breakdown as
    | { options: { systemId: string; lines: CostLine[] }[]; addons: { addonId: string; costCents: number }[] }
    | undefined;
  const chosenAddons = new Set(((signature?.addons ?? []) as { addonId: string }[]).map((a) => a.addonId));
  const planned = breakdown && signature
    ? {
        lines: breakdown.options.find((o) => o.systemId === signature.system_id)?.lines ?? [],
        addons: breakdown.addons.filter((a) => chosenAddons.has(a.addonId)),
      }
    : null;
  const pnl = jobPnl({
    contractCents: job.total_cents,
    payments: (payments ?? []).map((p) => ({ amountCents: p.amount_cents, voided: Boolean(p.voided_at) })),
    costs: (costs ?? []).map((c) => ({ kind: c.kind as CostKind, amountCents: c.amount_cents, voided: Boolean(c.voided_at) })),
    planned,
  });
  const gutterFeet = ((job.scope?.addons ?? []) as { name: string; qty: number }[]).find((a) => /gutter/i.test(a.name))?.qty;
  const today = companyToday();

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/jobs">← Jobs</Link></p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{job.customer_name}</h1>
        <span className="pill">{job.status.replace("_", " ")}</span>
      </div>
      <p className="text-sm text-muted">
        {job.address} · {job.system_name} · <Link className="underline" href={`/office/proposals/${job.proposal_id}`}>agreement</Link>
        {job.install_date && <> · install {formatDate(job.install_date)}</>}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Contract", value: formatCents(pnl.contractCents) },
          { label: "Costs so far", value: formatCents(pnl.costCents) },
          { label: "Profit", value: signed(pnl.profitCents), note: pnl.marginPct === null ? undefined : `${pnl.marginPct}% margin` },
          { label: "Still owed", value: formatCents(pnl.owedCents), note: `${formatCents(pnl.paidCents)} received` },
        ].map((t) => (
          <div key={t.label} className="card">
            <p className="text-sm text-muted">{t.label}</p>
            <p className={`text-2xl font-semibold ${t.label === "Profit" && pnl.profitCents < 0 ? "text-danger" : ""}`}>{t.value}</p>
            {t.note && <p className="text-xs text-muted">{t.note}</p>}
          </div>
        ))}
      </div>

      {pnl.compare.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Estimate vs actual</h2>
          <table className="table text-sm">
            <thead><tr><th>Cost</th>{planned && <th className="text-right">Estimated</th>}<th className="text-right">Actual</th>{planned && <th className="text-right">Difference</th>}</tr></thead>
            <tbody>
              {pnl.compare.map((r) => (
                <tr key={r.key}>
                  <td>{COMPARE_LABEL[r.key]}</td>
                  {planned && <td className="text-right">{formatCents(r.plannedCents ?? 0)}</td>}
                  <td className="text-right">{signed(r.actualCents)}</td>
                  {planned && (
                    <td className={`text-right ${r.actualCents > (r.plannedCents ?? 0) ? "text-danger" : "text-ok"}`}>
                      {signed(r.actualCents - (r.plannedCents ?? 0))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!planned && member.role !== "owner" && <p className="mt-1 text-xs text-muted">Owners also see the estimated costs here.</p>}
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Costs</h2>
        <table className="table text-sm">
          <tbody>
            {(costs ?? []).map((c) => (
              <tr key={c.id} className={c.voided_at ? "opacity-50 line-through" : ""}>
                <td>{formatDate(c.incurred_on)}</td>
                <td>{COST_LABEL[c.kind as CostKind]}</td>
                <td>{c.description}{c.vendor && <span className="text-muted"> · {c.vendor}</span>}{c.reference && <span className="text-muted"> #{c.reference}</span>}
                  {c.qty !== null && c.unit_cents !== null && <span className="text-xs text-muted"> ({Number(c.qty)} × {formatCents(Math.round(Number(c.unit_cents)))})</span>}</td>
                <td className="text-right">{signed(c.amount_cents)}</td>
                <td>
                  {!c.voided_at && (
                    <details className="text-xs">
                      <summary className="cursor-pointer">Void</summary>
                      <form action={voidJobCost} className="mt-1 flex gap-1">
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="costId" value={c.id} />
                        <input name="reason" required placeholder="Why" className="input" />
                        <button className="btn-secondary">Void</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
            {(costs ?? []).length === 0 && <tr><td className="text-muted">No costs yet.</td></tr>}
          </tbody>
        </table>

        <form action={addJobCost} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-6 sm:items-end">
          <input type="hidden" name="jobId" value={job.id} />
          <label className="label"><span>Kind</span>
            <select name="kind" className="input" defaultValue="crew">
              <option value="crew">Crew</option>
              <option value="materials">Supplier materials</option>
              <option value="permit">Permit</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="label sm:col-span-2"><span>What</span><input name="description" required placeholder="Install crew, 30 sq at $90" className="input" /></label>
          <label className="label"><span>Amount ($)</span><input name="amount" inputMode="decimal" className="input" /></label>
          <label className="label"><span>or qty</span><input name="qty" inputMode="decimal" className="input" /></label>
          <label className="label"><span>× rate ($)</span><input name="unit" inputMode="decimal" className="input" /></label>
          <label className="label sm:col-span-2"><span>Paid to / supplier</span><input name="vendor" className="input" /></label>
          <label className="label"><span>Bill / check #</span><input name="reference" className="input" /></label>
          <label className="label"><span>Date</span><input name="incurredOn" type="date" defaultValue={today} className="input" /></label>
          <button className="btn sm:justify-self-start">Add cost</button>
        </form>

        <div className="flex flex-wrap items-end gap-4 border-t border-border pt-3">
          <form action={addOwnEquipment} className="flex items-end gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="kind" value="dumpster" />
            <label className="label"><span>Our dumpsters</span><input name="qty" defaultValue={1} className="input w-16" /></label>
            <button className="btn-secondary">Charge</button>
          </form>
          <form action={addOwnEquipment} className="flex items-end gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="kind" value="gutters" />
            <label className="label"><span>Our gutters (ft)</span><input name="qty" defaultValue={gutterFeet ?? ""} className="input w-20" /></label>
            <button className="btn-secondary">Charge</button>
          </form>
          {(items ?? []).length > 0 && (
            <form action={pullStock} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="jobId" value={job.id} />
              <label className="label"><span>From the shelf</span>
                <select name="itemId" className="input">
                  {(items ?? []).map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({Number(i.on_hand)} {i.unit} at {formatCents(Math.round(Number(i.avg_cost_cents)))})</option>
                  ))}
                </select>
              </label>
              <label className="label"><span>Qty</span><input name="qty" inputMode="decimal" required className="input w-16" /></label>
              <button name="direction" value="pull" className="btn-secondary">Pull</button>
              <button name="direction" value="return" className="btn-secondary">Return</button>
            </form>
          )}
          <Link className="text-sm underline" href="/office/stock">Stock</Link>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Payments</h2>
        <table className="table text-sm">
          <tbody>
            {(payments ?? []).map((p) => (
              <tr key={p.id} className={p.voided_at ? "opacity-50 line-through" : ""}>
                <td>{formatDate(p.received_on)}</td>
                <td>{p.method}{p.reference && ` #${p.reference}`}</td>
                <td className="text-right">{formatCents(p.amount_cents)}</td>
                <td>
                  {!p.voided_at && (
                    <details className="text-xs">
                      <summary className="cursor-pointer">Void</summary>
                      <form action={voidJobPayment} className="mt-1 flex gap-1">
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input name="reason" required placeholder="Why" className="input" />
                        <button className="btn-secondary">Void</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pnl.owedCents > 0 && (
          <form action={recordJobPayment} className="grid gap-2 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="jobId" value={job.id} />
            <label className="label"><span>Amount ($)</span><input name="amount" required inputMode="decimal" className="input" /></label>
            <label className="label"><span>Method</span>
              <select name="method" className="input">{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            </label>
            <label className="label"><span>Check / ref #</span><input name="reference" className="input" /></label>
            <label className="label"><span>Received</span><input name="receivedOn" type="date" defaultValue={today} className="input" /></label>
            <button className="btn sm:justify-self-start">Record payment</button>
          </form>
        )}
      </section>
    </>
  );
}
