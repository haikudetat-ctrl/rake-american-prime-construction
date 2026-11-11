import Link from "next/link";
import { notFound } from "next/navigation";
import { recordSubStatementPayment, voidSubStatement } from "@/app/office/subs/actions";
import { Notice } from "@/app/office/_notice";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { MoneyForm } from "@/app/_ui/money-form";
import { Submit } from "@/app/_ui/submit";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate, formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadSubStatement } from "@/lib/subcontract/statement";
import { periodText } from "@/lib/subcontract/view";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** One weekly statement to a contractor: its jobs, one payment against all of them, and a void for an owner. */
export default async function SubStatementPage({ params, searchParams }: PageProps<"/office/subs/statements/[id]">) {
  const member = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const statement = await loadSubStatement(await createSupabaseServerClient(), id);
  if (!statement) notFound();
  const here = `/office/subs/statements/${id}`;

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/subs/statements">← Statements</Link></p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">Statement #{statement.number} · {statement.contractor.name}</h1>
        <a className="btn-secondary" href={`${here}/pdf`} target="_blank" rel="noreferrer">PDF</a>
      </div>
      <p className="text-sm text-muted">
        Work {periodText(statement.periodStart, statement.periodEnd)} · issued {formatDate(statement.issuedOn)} · due {formatDate(statement.dueOn)} ·{" "}
        {statement.sentAt
          ? `emailed to ${statement.contractor.billingEmail} ${formatDateTime(statement.sentAt)}`
          : statement.contractor.billingEmail ? "email queued" : "no billing email on file"}
        {statement.status === "void" && <strong> · Void: {statement.voidReason}</strong>}
        {statement.status === "paid" && <strong> · Paid</strong>}
      </p>

      {statement.status !== "void" && (
        <section className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Invoice</th><th>Job</th><th>Labor</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {statement.invoices.flatMap((invoice) =>
                invoice.lines.map((line, i) => (
                  <tr key={`${invoice.id}-${i}`}>
                    <td>{i === 0 && <Link className="underline" href={`/office/subs/${invoice.jobId}`}>#{invoice.number}</Link>}</td>
                    <td>{i === 0 && <>{invoice.address}<div className="text-xs text-muted">{formatDate(invoice.workDate)} · {invoice.scope}</div></>}</td>
                    <td>{line.description}</td>
                    <td className="text-right">{formatCents(line.amountCents)}</td>
                  </tr>
                )),
              )}
              <tr><td colSpan={3} className="text-right font-semibold">Total</td><td className="text-right font-semibold">{formatCents(statement.totalCents)}</td></tr>
              <tr><td colSpan={3} className="text-right">Paid</td><td className="text-right">{formatCents(statement.paidCents)}</td></tr>
              <tr><td colSpan={3} className="text-right font-semibold">Balance</td><td className="text-right font-semibold">{formatCents(statement.balanceCents)}</td></tr>
            </tbody>
          </table>
        </section>
      )}

      {statement.status !== "void" && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Payments</h2>
          <ul className="text-sm">
            {statement.payments.map((p) => (
              <li key={p.id}>
                {formatDate(p.receivedOn)} · {formatCents(p.amountCents)} · {p.method}{p.reference && ` #${p.reference}`} · invoice #{p.invoiceNumber}
              </li>
            ))}
            {statement.payments.length === 0 && <li className="text-muted">None yet.</li>}
          </ul>
          {statement.status === "open" && (
            <>
              <MoneyForm action={recordSubStatementPayment} recheckHref={here} className="grid gap-2 sm:grid-cols-5 sm:items-end">
                <input type="hidden" name="statementId" value={id} />
                <label className="label"><span>Amount</span>
                  <input name="amount" required inputMode="decimal" defaultValue={(statement.balanceCents / 100).toFixed(2)} className="input" />
                </label>
                <label className="label"><span>How</span>
                  <select name="method" className="input" defaultValue="check">
                    <option value="check">Check</option><option value="ach">ACH</option><option value="cash">Cash</option><option value="other">Other</option>
                  </select>
                </label>
                <label className="label"><span>Check # / ref</span><input name="reference" className="input" /></label>
                <label className="label"><span>Received</span><input name="receivedOn" type="date" defaultValue={companyToday()} className="input" /></label>
                <Submit className="btn">Record payment</Submit>
              </MoneyForm>
              <p className="text-xs text-muted">One check for the statement is spread over its jobs, oldest invoice first, so each job shows what&apos;s paid.</p>
            </>
          )}
        </section>
      )}

      {member.role === "owner" && statement.status === "open" && statement.payments.length === 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Void this statement</h2>
          <p className="text-sm text-muted">
            To fix a job after the statement went out: void it, reopen and correct the job, then send a new statement.
          </p>
          <ConfirmAction
            action={voidSubStatement}
            trigger="Void statement"
            title={`Void statement #${statement.number}?`}
            hidden={{ statementId: statement.id }}
            reason={{ label: "Reason", placeholder: "Squares were wrong on one job…" }}
            effects={[
              `Statement #${statement.number} for ${formatCents(statement.totalCents)} is voided and stays on record with your reason.`,
              `Its ${statement.invoices.length} ${statement.invoices.length === 1 ? "job goes" : "jobs go"} back to waiting, where any of them can be reopened and corrected.`,
              statement.sentAt
                ? `${statement.contractor.name} already has it by email and isn't told it's void, so send them a note. The corrected jobs go on the next statement.`
                : "Its email hasn't gone out and won't. The corrected jobs go on the next statement.",
            ]}
            acknowledgment={`Void statement #${statement.number}.`}
            submitLabel="Void statement"
            pendingLabel="Voiding…"
            recheckHref={here}
          />
        </section>
      )}
    </>
  );
}
