import { Submit } from "../_submit";
import { Closeout } from "../_closeout";
import { Unavailable } from "../../_unavailable";
import { subQuery } from "@/lib/subcontract/navigation";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addSubExtra,
  addSubPriceItem,
  cancelSubJob,
  recordSubPayment,
  removeSubExtra,
  reopenSubJob,
  updateSubJob,
  voidSubPayment,
} from "@/app/office/subs/actions";
import { CrewPicker, rateText, STATUS_LABEL } from "@/app/office/subs/_parts";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { MoneyForm } from "@/app/_ui/money-form";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate, formatDateTime, weekStart } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadTeam, one } from "@/lib/office/team";
import { loadSubInvoice } from "@/lib/subcontract/invoice";
import { parseStale } from "@/lib/subcontract/review";
import { readTiers, unitLabel } from "@/lib/subcontract/tiers";
import { jobScope } from "@/lib/subcontract/view";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EXTRA_IDEAS = ["Plywood sheet", "Extra layer tear-off", "Second story", "Step flashing", "Chimney flashing"];

/** One subcontract job: crew and extras while it's open; the bill, crew pay and invoice once it's closed. */
export default async function SubJobPage({ params, searchParams }: PageProps<"/office/subs/[id]">) {
  const member = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();

  // The closeout fingerprint is read before anything the review shows. Everything
  // below is then at least as new as the fingerprint, and any edit after it fails
  // the check when the job is closed, so a review can never confirm older numbers.
  const { data: fingerprint } = await supabase.rpc("sub_job_closeout_fingerprint", { p_job_id: id });

  const [{ data: job, error: jobError }, { data: contractors, error: contractorError }, { data: workers, error: workerError }, { data: settings, error: settingsError }, { data: invoices, error: invoiceError }, { data: events }, team, { data: priceItems }] =
    await Promise.all([
      supabase
        .from("sub_jobs")
        .select("*, sub_contractors(id, name, billing_email, cents_per_sq, pitch_tiers, min_job_cents), sub_job_crew(worker_id, pay_cents, sub_workers(name)), sub_job_extras(id, description, qty, unit, bill_unit_cents, pay_unit_cents, created_at)")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("sub_contractors").select("id, name").order("name"),
      supabase.from("sub_workers").select("id, name, is_active").order("name").order("id"),
      supabase.from("sub_settings").select("*").maybeSingle(),
      supabase.from("sub_invoices").select("id, number, status, void_reason").eq("job_id", id).order("created_at", { ascending: false }),
      supabase.from("domain_events").select("event_type, payload, actor_id, occurred_at").eq("aggregate_id", id).order("occurred_at", { ascending: false }).limit(20),
      loadTeam(supabase),
      supabase.from("sub_price_items").select("id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents")
        .eq("is_active", true).order("description"),
    ]);
  // RLS scoped every read above to staff of this company.
  if (jobError || settingsError || invoiceError || workerError || contractorError) return <Unavailable />;
  if (!job) notFound();
  const returnQuery = subQuery({ week: query.week ?? weekStart(job.work_date), filter: query.filter });
  const here = `/office/subs/${job.id}${returnQuery}`;
  const number = (v: unknown) => (typeof v === "string" && /^\d{1,3}(\.\d{1,2})?$/.test(v) ? v : null);
  const typed = number(query.squares) && number(query.pitch) ? { squares: number(query.squares)!, pitch: number(query.pitch)! } : null;

  const contractor = one(job.sub_contractors);
  if (!contractor) return <Unavailable />;
  const crew = [...(job.sub_job_crew ?? [])]
    .map((c) => ({ id: c.worker_id as string, name: one(c.sub_workers)?.name ?? "", payCents: c.pay_cents as number | null }))
    .sort((a, b) => (workers ?? []).findIndex(w => w.id === a.id) - (workers ?? []).findIndex(w => w.id === b.id));
  const extras = [...(job.sub_job_extras ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const live = (invoices ?? []).find((i) => i.status !== "void");
  const voided = (invoices ?? []).filter((i) => i.status === "void");
  const invoice = live ? await loadSubInvoice(supabase, live.id) : null;
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const crewRate = {
    base: settings?.crew_cents_per_sq ?? 5000,
    // Same default as the database when no crew rates were ever saved: $5 a step from 9/12.
    tiers: settings ? readTiers(settings.crew_pitch_tiers) : Array.from({ length: 16 }, (_, i) => ({ from: 9 + i, cents: 500 * (i + 1) })),
  };
  const billRate = {
    base: contractor?.cents_per_sq ?? 0,
    tiers: readTiers(contractor?.pitch_tiers),
    minimumCents: contractor?.min_job_cents ?? null,
  };
  // Only this job's contractor's list: the database refuses anyone else's.
  const listItems = (priceItems ?? []).filter((i) => i.contractor_id === job.contractor_id);
  // Who can be on the job: everyone active, plus anyone already on it who has since left the list.
  const pickable = (workers ?? []).filter((w) => w.is_active || crew.some((c) => c.id === w.id));
  const isOwner = member.role === "owner";
  const emailHeldUntil =
    invoice && !invoice.sentAt && invoice.status !== "void" && invoice.contractor.billingEmail && job.done_at
      ? new Date(new Date(job.done_at).getTime() + 15 * 60_000).toISOString()
      : null;

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm">
        <Link className="underline" href={`/office/subs${returnQuery}`}>← Back to jobs</Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">{job.address}</h1>
        <span className={`pill ${job.status === "scheduled" ? "border-warn text-warn" : ""}`}>{STATUS_LABEL[job.status]}</span>
      </div>
      <p className="text-sm text-muted">
        {contractor?.name} · {formatDate(job.work_date)} · {crew.length ? crew.map((c) => c.name).join(", ") : "no crew yet"}
        {job.notes && <> · {job.notes}</>}
        {job.status === "void" && job.void_reason && <> · Cancelled: {job.void_reason}</>}
      </p>

      {job.status === "scheduled" && (
        <>
          <section id="finish" className="card-stripe scroll-mt-4 space-y-3">
            <h2 className="font-semibold">Finish job</h2>
            <p className="text-sm text-muted">
              {contractor?.name} pays {rateText(billRate.base, billRate.tiers, billRate.minimumCents)}.
              {" "}Crew gets {rateText(crewRate.base, crewRate.tiers)}
              {crew.length > 0 ? `, split ${crew.length} ways` : ""}.
            </p>
            {crew.length === 0 ? (
              <p className="text-sm text-warn">Pick the crew below first.</p>
            ) : !fingerprint ? (
              <p role="status" className="text-sm text-danger">Finishing is unavailable right now, so this job can&apos;t be closed from here. Reload to try again.</p>
            ) : (
              <Closeout jobId={job.id} contractor={contractor?.name ?? "Contractor"} email={contractor?.billing_email ?? null}
                crew={crew} extras={extras.map(e => ({ ...e, qty: Number(e.qty) }))} crewRate={crewRate}
                billRate={billRate} returnQuery={returnQuery}
                fingerprint={JSON.stringify(fingerprint)} recheckHref={`${here}#finish`} stale={parseStale(query.stale)} initial={typed} />
            )}
            <p className="text-xs text-muted">
              Closing splits the crew pay, records earned crew pay for this week, and issues the invoice
              {contractor?.billing_email ? `, emailed to ${contractor.billing_email} 15 minutes later` : " (no billing email on file, so it's ready to download)"}.
            </p>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold">Extras</h2>
            {extras.length === 0 ? (
              <p className="text-sm text-muted">Gutters, plywood, an extra layer, a second story: anything paid beyond the squares. A gutter-only job closes at 0 squares.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Extra</th><th className="text-right">Qty</th><th className="text-right">Contractor pays</th><th className="text-right">Crew gets</th><th /></tr></thead>
                <tbody>
                  {extras.map((e) => (
                    <tr key={e.id}>
                      <td>{e.description}</td>
                      <td className="text-right">{Number(e.qty)}</td>
                      <td className="text-right">{formatCents(e.bill_unit_cents)} {unitLabel(e.unit)}</td>
                      <td className="text-right">{formatCents(e.pay_unit_cents)} {unitLabel(e.unit)}</td>
                      <td className="w-px">
                        <form action={removeSubExtra}>
                          <input type="hidden" name="jobId" value={job.id} />
                          <input type="hidden" name="returnQuery" value={returnQuery} />
                          <input type="hidden" name="extraId" value={e.id} />
                          <button className="text-xs underline">remove</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {listItems.length > 0 && (
              <form action={addSubPriceItem} className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end">
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="returnQuery" value={returnQuery} />
                <label className="label col-span-2 sm:col-span-3">
                  <span>From {contractor.name}&apos;s price list</span>
                  <select name="itemId" required className="input">
                    {listItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.description}: {formatCents(i.bill_unit_cents)} {unitLabel(i.unit)} (crew {formatCents(i.pay_unit_cents)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label"><span>How many</span><input name="qty" required inputMode="decimal" placeholder="120" className="input" /></label>
                <button className="btn-secondary">Add</button>
              </form>
            )}
            <form action={addSubExtra} className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end">
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="returnQuery" value={returnQuery} />
              <label className="label col-span-2">
                <span>What</span>
                <input name="description" required list="extra-ideas" placeholder="Plywood sheet" className="input" />
                <datalist id="extra-ideas">{EXTRA_IDEAS.map((x) => <option key={x} value={x} />)}</datalist>
              </label>
              <label className="label"><span>How many</span><input name="qty" required inputMode="decimal" className="input" /></label>
              <label className="label"><span>Contractor $ each</span><input name="bill" inputMode="decimal" placeholder="0" className="input" /></label>
              <label className="label"><span>Crew $ each</span><input name="pay" inputMode="decimal" placeholder="0" className="input" /></label>
              <button className="btn-secondary col-span-2 sm:col-span-5 sm:justify-self-start">Add extra</button>
            </form>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold">Job and crew</h2>
            <form action={updateSubJob} className="space-y-3">
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="returnQuery" value={returnQuery} />
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="label">
                  <span>Day</span>
                  <input name="workDate" type="date" required defaultValue={job.work_date} className="input" />
                </label>
                <label className="label sm:col-span-2">
                  <span>Contractor</span>
                  <select name="contractorId" required defaultValue={job.contractor_id} className="input">
                    {(contractors ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="label"><span>Address</span><input name="address" required defaultValue={job.address} className="input" /></label>
              <CrewPicker workers={pickable} selected={crew.map((c) => c.id)} />
              <label className="label"><span>Notes</span><input name="notes" defaultValue={job.notes ?? ""} className="input" /></label>
              <Submit>Save job and crew</Submit>
            </form>
            <div className="border-t border-border pt-3">
              <ConfirmAction
                action={cancelSubJob}
                trigger="Cancel job"
                title="Cancel this job?"
                hidden={{ jobId: job.id, returnQuery }}
                reason={{ label: "Why", placeholder: "Rain, moved, contractor called it off…", required: false }}
                effects={[
                  "The job stays on the list, marked cancelled, with your reason.",
                  "No invoice is issued and no crew pay is recorded for it.",
                  "A cancelled job can't be closed later; add a new job if the work happens after all.",
                ]}
                acknowledgment="Cancel this job."
                submitLabel="Cancel job"
                pendingLabel="Cancelling…"
                recheckHref={here}
              />
            </div>
          </section>
        </>
      )}

      {job.status === "done" && (
        <>
          {/* Three across even on a phone, so the figures shrink there rather than wrap. */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="card-stripe px-3 sm:px-4"><p className="eyebrow">Billed</p><p className="stat-value text-lg sm:text-3xl">{formatCents(job.bill_total_cents)}</p></div>
            <div className="card-stripe px-3 sm:px-4"><p className="eyebrow">Crew</p><p className="stat-value text-lg sm:text-3xl">{formatCents(job.pay_total_cents)}</p></div>
            <div className="card-stripe px-3 sm:px-4">
              <p className="eyebrow">Billed less crew</p>
              <p className="stat-value text-lg sm:text-3xl">{formatCents((job.bill_total_cents ?? 0) - (job.pay_total_cents ?? 0))}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-3">
              <h2 className="font-semibold">Crew pay earned</h2>
              <p className="text-sm text-muted">Worker payment status is not tracked.</p>
              <p className="text-sm text-muted">
                {Number(job.squares) > 0 ? (
                  <>
                    {Number(job.squares)} sq × {formatCents((job.pay_base_cents ?? 0) + (job.pay_pitch_cents ?? 0))}
                    {(job.pay_pitch_cents ?? 0) > 0 && <> ({formatCents(job.pay_base_cents)} + {formatCents(job.pay_pitch_cents)} for {job.pitch}/12)</>}
                    {extras.some((e) => e.pay_unit_cents > 0) && <> plus extras</>}
                  </>
                ) : (
                  <>{jobScope(0, 0)}</>
                )}, split {crew.length} ways.
              </p>
              <table className="table">
                <tbody>
                  {crew.map((c) => (
                    <tr key={c.id}><td>{c.name}</td><td className="text-right">{formatCents(c.payCents)}</td></tr>
                  ))}
                  <tr><td className="font-semibold">Total</td><td className="text-right font-semibold">{formatCents(job.pay_total_cents)}</td></tr>
                </tbody>
              </table>
            </section>

            {invoice && (
              <section className="card space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">Invoice #{invoice.number} to {invoice.contractor.name}</h2>
                  <a className="text-sm underline" href={`/office/subs/${job.id}/invoice`} target="_blank" rel="noreferrer">PDF</a>
                </div>
                <p className="text-sm text-muted">
                  Issued {formatDate(invoice.issuedOn)} · due {formatDate(invoice.dueOn)} ·{" "}
                  {invoice.status === "paid"
                    ? "paid"
                    : invoice.sentAt
                      ? `emailed ${formatDateTime(invoice.sentAt)}`
                      : emailHeldUntil
                        ? `emails to ${invoice.contractor.billingEmail} at ${formatDateTime(emailHeldUntil)}`
                        : "not emailed (no billing email)"}
                </p>
                <table className="table">
                  <tbody>
                    {invoice.lines.map((line, i) => (
                      <tr key={i}><td>{line.description}</td><td className="text-right">{formatCents(line.amountCents)}</td></tr>
                    ))}
                    <tr><td className="font-semibold">Total</td><td className="text-right font-semibold">{formatCents(invoice.totalCents)}</td></tr>
                    {invoice.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="text-muted">
                          Paid {formatDate(p.receivedOn)} · {p.method}{p.reference ? ` #${p.reference}` : ""}
                          <div className="mt-1">
                            <ConfirmAction
                              action={voidSubPayment}
                              trigger="Void"
                              triggerClassName="text-xs font-semibold underline"
                              title={`Void the ${formatCents(p.amountCents)} payment?`}
                              hidden={{ jobId: job.id, returnQuery, paymentId: p.id }}
                              reason={{ label: "Why void it", placeholder: "Bounced check, entered twice…" }}
                              effects={[
                                `The ${formatCents(p.amountCents)} payment from ${formatDate(p.receivedOn)} stays on record, marked void with your reason.`,
                                `Invoice #${invoice.number}'s balance goes back up by ${formatCents(p.amountCents)}${invoice.status === "paid" ? ", and it shows as open again" : ""}.`,
                              ]}
                              acknowledgment="Void this payment."
                              submitLabel="Void payment"
                              pendingLabel="Voiding…"
                              recheckHref={here}
                            />
                          </div>
                        </td>
                        <td className="text-right text-muted">−{formatCents(p.amountCents)}</td>
                      </tr>
                    ))}
                    {invoice.payments.length > 0 && (
                      <tr><td className="font-semibold">Balance</td><td className="text-right font-semibold">{formatCents(invoice.balanceCents)}</td></tr>
                    )}
                  </tbody>
                </table>
                {invoice.status === "open" && (
                  <MoneyForm action={recordSubPayment} recheckHref={here} className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4 sm:items-end">
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="returnQuery" value={returnQuery} />
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <label className="label"><span>Amount ($)</span>
                      <input name="amount" required inputMode="decimal" defaultValue={(invoice.balanceCents / 100).toFixed(2)} className="input" />
                    </label>
                    <label className="label"><span>How</span>
                      <select name="method" className="input" defaultValue="check">
                        <option value="check">Check</option><option value="ach">ACH</option><option value="cash">Cash</option><option value="other">Other</option>
                      </select>
                    </label>
                    <label className="label"><span>Check #</span><input name="reference" className="input" /></label>
                    <label className="label"><span>Received</span><input name="receivedOn" type="date" defaultValue={companyToday()} className="input" /></label>
                    <Submit className="btn-secondary col-span-2 sm:col-span-4 sm:justify-self-start">Record payment</Submit>
                  </MoneyForm>
                )}
              </section>
            )}
          </div>

          {isOwner && invoice?.status === "open" && invoice.payments.length === 0 && (
            <section className="card space-y-2">
              <p className="text-sm text-muted">Wrong squares, pitch or crew? Reopen the job to fix it.</p>
              <ConfirmAction
                action={reopenSubJob}
                trigger="Reopen job"
                title={`Reopen and void invoice #${invoice.number}?`}
                hidden={{ jobId: job.id, returnQuery }}
                reason={{ label: "What was wrong", placeholder: "Squares were 22, not 25…" }}
                effects={[
                  `Invoice #${invoice.number} for ${formatCents(invoice.totalCents)} is voided. It stays on record with your reason${!invoice.sentAt && invoice.contractor.billingEmail ? ", and its email won't go out" : ""}.`,
                  ...(invoice.sentAt ? [`${invoice.contractor.name} already has it by email, so let them know it's replaced.`] : []),
                  `The ${formatCents(job.pay_total_cents)} crew pay recorded for this job is cleared until it closes again.`,
                  "The job goes back to scheduled. Closing it again issues a new invoice with a new number.",
                ]}
                acknowledgment={`Void invoice #${invoice.number} and reopen the job.`}
                submitLabel="Reopen job"
                pendingLabel="Reopening…"
                recheckHref={here}
              />
            </section>
          )}
        </>
      )}

      {voided.length > 0 && (
        <p className="text-xs text-muted">
          Void: {voided.map((v) => `#${v.number}${v.void_reason ? ` (${v.void_reason})` : ""}`).join(", ")}
        </p>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {(events ?? []).map((e, i) => (
            <li key={i}>
              <span className="text-muted">{formatDateTime(e.occurred_at)}</span> · {e.event_type.replace(/^sub_/, "").replaceAll("_", " ")}
              {e.actor_id && <> · {names.get(e.actor_id) ?? "someone"}</>}
              {typeof e.payload?.reason === "string" && e.payload.reason && <> · “{e.payload.reason}”</>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
