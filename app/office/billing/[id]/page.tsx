import { notFound } from "next/navigation";
import { recordPayment } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadStatement } from "@/lib/billing/statement";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function StatementPage({ params, searchParams }: PageProps<"/office/billing/[id]">) {
  await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const statement = await loadStatement(await createSupabaseServerClient(), id);
  if (!statement) notFound();

  return (
    <>
      <Notice searchParams={query} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Statement #{statement.number} · {statement.customer.name}</h1>
        <a className="btn-secondary" href={`/office/billing/${id}/pdf`}>Download PDF</a>
      </div>
      <p className="text-sm text-muted">
        Issued {formatDate(statement.issuedOn)} · due {formatDate(statement.dueOn)} ·{" "}
        {statement.sentAt ? `emailed to ${statement.customer.billingEmail}` : statement.customer.billingEmail ? "email queued" : "no billing email on file"}
      </p>

      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Invoice</th><th>Job</th><th>Line</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {statement.invoices.flatMap((invoice) =>
              invoice.lines.map((line, i) => (
                <tr key={`${invoice.number}-${i}`}>
                  <td>{i === 0 ? `#${invoice.number}` : ""}</td>
                  <td>{i === 0 ? <>{invoice.address}<div className="text-xs text-muted">{invoice.dates}</div></> : ""}</td>
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

      <section className="card space-y-3">
        <h2 className="font-semibold">Payments</h2>
        <ul className="text-sm">
          {statement.payments.map((p, i) => (
            <li key={i}>{formatDate(p.receivedOn)} · {formatCents(p.amountCents)} · {p.method}{p.reference && ` #${p.reference}`}</li>
          ))}
          {statement.payments.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
        {statement.status === "open" && (
          <form action={recordPayment} className="grid gap-2 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="statementId" value={id} />
            <label className="label"><span>Amount</span><input name="amount" required inputMode="decimal" defaultValue={(statement.balanceCents / 100).toFixed(2)} className="input" /></label>
            <label className="label"><span>Method</span>
              <select name="method" className="input">
                <option value="check">Check</option><option value="ach">ACH</option><option value="cash">Cash</option><option value="other">Other</option>
              </select>
            </label>
            <label className="label"><span>Check # / ref</span><input name="reference" className="input" /></label>
            <label className="label"><span>Received</span><input name="receivedOn" type="date" defaultValue={companyToday()} className="input" /></label>
            <button className="btn">Record payment</button>
          </form>
        )}
      </section>
    </>
  );
}
