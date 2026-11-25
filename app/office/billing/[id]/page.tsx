import Link from "next/link";
import { notFound } from "next/navigation";
import { recordPayment, voidStatement } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Callout } from "@/app/_ui/callout";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Icon } from "@/app/_ui/icon";
import { StatusPill, type Tone } from "@/app/_ui/status-pill";
import { MoneyForm } from "@/app/_ui/money-form";
import { Submit } from "@/app/_ui/submit";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadStatement } from "@/lib/billing/statement";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function StatementPage({ params, searchParams }: PageProps<"/office/billing/[id]">) {
  const member = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const statement = await loadStatement(await createSupabaseServerClient(), id);
  if (!statement) notFound();

  const today = companyToday();
  const state: { label: string; tone: Tone } =
    statement.status === "void" ? { label: "Void", tone: "neutral" }
      : statement.status === "paid" ? { label: "Paid", tone: "success" }
        : statement.dueOn < today ? { label: "Overdue", tone: "danger" }
          : { label: "Open", tone: "warning" };
  // Queued is not sent: only a recorded send time means the email went out.
  const delivery = statement.sentAt
    ? `Emailed to ${statement.customer.billingEmail}`
    : statement.customer.billingEmail
      ? `Email queued to ${statement.customer.billingEmail}, not sent yet`
      : "No billing email on file. Download the PDF and send it yourself";

  return (
    <>
      <Notice searchParams={query} />
      <header className="space-y-1">
        <p className="eyebrow">Office · Dumpster billing · Statement</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">Statement #{statement.number}</h1>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
          <a className="btn-secondary ml-auto" href={`/office/billing/${id}/pdf`}>Download PDF</a>
        </div>
        <p className="text-muted">{statement.customer.name} · issued {formatDate(statement.issuedOn)} · due {formatDate(statement.dueOn)}</p>
      </header>

      {statement.status === "void" && (
        <Callout tone="neutral" title="This statement was voided">
          {statement.voidReason ? `Reason: ${statement.voidReason}. ` : ""}Its invoices went back to Ready to bill and go on the next statement.
        </Callout>
      )}

      <WithRail
        rail={
          <>
            <RailCard title="Delivery and accounting">
              <p>{delivery}.</p>
              <p className="text-xs text-muted">Delivery is separate from payment. Each invoice below shows whether it reached QuickBooks.</p>
            </RailCard>
            <RailCard title="Who can change it">
              <p className="text-xs text-muted">Office staff can record payments on an open statement. Only an owner can void it, and only before any payment is recorded.</p>
            </RailCard>
          </>
        }
      >
        <section className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-2xl font-bold">{formatCents(statement.balanceCents)} <span className="text-base font-normal text-muted">balance</span></p>
            <p className="text-sm text-muted">Total {formatCents(statement.totalCents)} · paid {formatCents(statement.paidCents)}</p>
          </div>
        </section>

        <section aria-labelledby="included" className="space-y-2.5">
          <h2 id="included" className="text-base">Included invoices <span className="font-normal text-muted">Open one to see its rental</span></h2>
          <ul aria-label="Included invoices" className="space-y-3">
            {statement.invoices.map((invoice) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold break-words sm:text-base">#{invoice.number} · {invoice.address}</span>
                    <span className="mt-1 block text-xs break-words text-muted sm:text-sm">
                      {[invoice.dates, invoice.lines.map((l) => `${l.description} ${formatCents(l.amountCents)}`).join(" + ")].filter(Boolean).join(" · ")}
                    </span>
                    {invoice.quickbooks.synced && <span className="mt-1 block text-xs text-muted">In QuickBooks</span>}
                    {invoice.quickbooks.error && <span className="mt-1 block text-xs text-danger" title={invoice.quickbooks.error}>QuickBooks sync failed</span>}
                  </span>
                  <span className="shrink-0 text-sm font-semibold">{formatCents(invoice.totalCents)}</span>
                </>
              );
              const row = "flex min-h-16 items-center gap-4 rounded-row border border-border/60 bg-surface px-4 py-3.5 sm:px-[18px]";
              return (
                <li key={invoice.number}>
                  {invoice.rentalId
                    ? <Link className={`${row} hover:border-border`} href={`/office/rentals/${invoice.rentalId}`}>{body}<Icon name="chevron-right" className="shrink-0 text-muted" /></Link>
                    : <div className={row}>{body}</div>}
                </li>
              );
            })}
          </ul>
        </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Payments</h2>
        {statement.status === "open" && <p className="text-xs text-muted">Record a payment you already received. This doesn&apos;t charge the customer.</p>}
        <ul className="text-sm">
          {statement.payments.map((p, i) => (
            <li key={i}>{formatDate(p.receivedOn)} · {formatCents(p.amountCents)} · {p.method}{p.reference && ` #${p.reference}`}</li>
          ))}
          {statement.payments.length === 0 && <li className="text-muted">No payments recorded yet.</li>}
        </ul>
        {statement.status === "open" && (
          <MoneyForm action={recordPayment} recheckHref={`/office/billing/${id}`} className="grid gap-2 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="statementId" value={id} />
            <label className="label"><span>Amount</span><input name="amount" required inputMode="decimal" defaultValue={(statement.balanceCents / 100).toFixed(2)} className="input" /></label>
            <label className="label"><span>Method</span>
              <select name="method" className="input">
                <option value="check">Check</option><option value="ach">ACH</option><option value="cash">Cash</option><option value="other">Other</option>
              </select>
            </label>
            <label className="label"><span>Check # / ref</span><input name="reference" className="input" /></label>
            <label className="label"><span>Received</span><input name="receivedOn" type="date" defaultValue={companyToday()} className="input" /></label>
            <Submit className="btn">Record payment</Submit>
          </MoneyForm>
        )}
      </section>

      {member.role === "owner" && statement.status === "open" && statement.payments.length === 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Void this statement</h2>
          <p className="text-sm text-muted">
            Use this to fix a charge after the statement went out. Its invoices go back to “Ready to bill”;
            correct them on the rental page, then issue a new statement. Send the customer a note that the old one is replaced.
          </p>
          <ConfirmAction
            action={voidStatement}
            trigger="Void statement"
            title={`Void statement #${statement.number}?`}
            hidden={{ statementId: statement.id }}
            reason={{ label: "Reason", placeholder: "Wrong tonnage on one rental…" }}
            effects={[
              `Statement #${statement.number} for ${formatCents(statement.totalCents)} is voided and stays on record with your reason.`,
              "Its invoices go back to Ready to bill, where they can be corrected on each rental's page.",
              "Any of its emails still waiting to go out, reminders included, are stopped.",
              `${statement.sentAt ? `${statement.customer.name} already has it by email and isn't told it's void, so send them a note. ` : ""}The corrected invoices go on the next statement.`,
            ]}
            acknowledgment={`Void statement #${statement.number}.`}
            submitLabel="Void statement"
            pendingLabel="Voiding…"
            recheckHref={`/office/billing/${id}`}
          />
        </section>
      )}
      </WithRail>
    </>
  );
}
