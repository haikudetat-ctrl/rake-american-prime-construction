import Link from "next/link";
import { notFound } from "next/navigation";
import { issueQuickInvoice, recordQuickPayment, sendQuickInvoice, voidQuickInvoice, voidQuickPayment } from "@/app/office/invoices/actions";
import { Notice } from "@/app/office/_notice";
import { Callout } from "@/app/_ui/callout";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { ConsequenceReview } from "@/app/_ui/consequence-review";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { MoneyForm } from "@/app/_ui/money-form";
import { StatusPill } from "@/app/_ui/status-pill";
import { Submit } from "@/app/_ui/submit";
import { requireStaff } from "@/lib/auth";
import { emailWaiting, loadQuickInvoice, quantityText, quickState } from "@/lib/billing/quick-invoice";
import { companyToday, formatDate, formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const METHOD: Record<string, string> = { check: "Check", ach: "ACH", cash: "Cash", card: "Card", other: "Other" };

/** One quick invoice: its preview while a draft, then delivery, payments and voiding. */
export default async function QuickInvoicePage({ params, searchParams }: PageProps<"/office/invoices/[id]">) {
  const member = await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const invoice = await loadQuickInvoice(supabase, id);
  if (!invoice) notFound();
  const today = companyToday();
  const state = quickState(invoice, today);
  const href = `/office/invoices/${id}`;
  const draft = invoice.status === "draft";
  // Queued is not sent: only a recorded send time means the email went out.
  const waiting = emailWaiting(invoice);
  const delivery = waiting
    ? `Email to ${invoice.emailQueuedTo} goes out after ${formatDateTime(invoice.emailQueuedFor!)}, if the email service is set up${invoice.sentAt ? `. Last sent to ${invoice.sentTo} ${formatDateTime(invoice.sentAt)}` : ""}`
    : invoice.sentAt
      ? `Emailed to ${invoice.sentTo} ${formatDateTime(invoice.sentAt)}`
      : draft
        ? "A draft. Nothing has been sent"
        : "Not emailed. Download the PDF to send it yourself, or email it below";

  return (
    <>
      <Notice searchParams={query} />
      <header className="space-y-1">
        <p className="eyebrow"><Link className="hover:underline" href="/office/invoices">Office · Invoices</Link></p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{draft ? "Draft invoice" : "Invoice"} #{invoice.number}</h1>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
          <div className="ml-auto flex flex-wrap gap-2">
            {draft && <Link className="btn-secondary" href={`${href}/edit`}>Edit</Link>}
            <a className="btn-secondary" href={`${href}/pdf`} target="_blank" rel="noopener">{draft ? "Preview PDF" : "Download PDF"}</a>
          </div>
        </div>
        <p className="text-muted">
          {invoice.billTo.name} · {invoice.brand.name} · {invoice.issuedOn ? `issued ${formatDate(invoice.issuedOn)} · ` : ""}due {formatDate(invoice.dueOn)}
        </p>
      </header>

      {invoice.status === "void" && (
        <Callout tone="neutral" title="This invoice was voided">
          {invoice.voidReason ? `Reason: ${invoice.voidReason}. ` : ""}Its number stays used. Make a new quick invoice if it still needs billing.
        </Callout>
      )}

      <WithRail
        rail={
          <>
            <RailCard title="Delivery">
              <p>{delivery}.</p>
            </RailCard>
            <RailCard title="Bill to">
              <p className="font-medium">{invoice.billTo.name}</p>
              {invoice.billTo.address && <p>{invoice.billTo.address}</p>}
              {invoice.billTo.phone && <p>{formatPhone(invoice.billTo.phone)}</p>}
              {invoice.billTo.email && <p className="break-all">{invoice.billTo.email}</p>}
            </RailCard>
            <RailCard title="Where it counts">
              <p className="text-xs text-muted">A quick invoice is on no dumpster or contractor statement and pays no crew. Its balance shows under Invoices and in Reporting. It isn&apos;t sent to QuickBooks.</p>
            </RailCard>
          </>
        }
      >
        <section className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-2xl font-bold">{formatCents(invoice.balanceCents)} <span className="text-base font-normal text-muted">{draft ? "total" : "balance"}</span></p>
            {!draft && <p className="text-sm text-muted">Total {formatCents(invoice.totalCents)} · paid {formatCents(invoice.paidCents)}</p>}
          </div>
          {invoice.memo && <p className="text-sm whitespace-pre-line">{invoice.memo}</p>}
          <ul aria-label="Lines" className="divide-y divide-border/60 border-t border-border/60 text-sm">
            {invoice.lines.map((line, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0">
                  <span className="block font-medium break-words">{line.description}</span>
                  <span className="block text-xs text-muted">{quantityText(line, formatCents)}{line.source !== "custom" ? " · from the price list" : ""}</span>
                </span>
                <span className="shrink-0 font-semibold">{formatCents(line.amountCents)}</span>
              </li>
            ))}
            {invoice.taxCents > 0 && (
              <li className="flex justify-between gap-4 py-2 text-muted">
                <span>Subtotal {formatCents(invoice.subtotalCents)} · sales tax {Number(invoice.taxPct.toFixed(3))}%</span>
                <span className="shrink-0">{formatCents(invoice.taxCents)}</span>
              </li>
            )}
          </ul>
        </section>

        {draft && (
          <section aria-labelledby="issue" className="card space-y-3">
            <h2 id="issue" className="font-semibold">Issue it</h2>
            <p className="text-sm text-muted">Check the PDF first. Once it&apos;s issued it can&apos;t be edited, only voided by an owner.</p>
            <MoneyForm action={issueQuickInvoice} recheckHref={href} className="space-y-3">
              <input type="hidden" name="invoiceId" value={id} />
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                <input type="checkbox" name="email" value="yes" defaultChecked={Boolean(invoice.billTo.email)} className="size-5" />
                <span>Email it with the PDF attached</span>
              </label>
              <label className="label">
                <span>To</span>
                <input type="email" name="sendTo" defaultValue={invoice.billTo.email ?? ""} className="input" placeholder="pat@example.com" />
              </label>
              <ConsequenceReview
                title="When you issue it"
                effects={[
                  `Invoice #${invoice.number} for ${formatCents(invoice.totalCents)} goes out as ${invoice.brand.name}, due ${formatDate(invoice.dueOn < today ? today : invoice.dueOn)}.`,
                  "If you ticked Email it, the email leaves 15 minutes from now, so a mistake can still be voided. Otherwise nothing is sent; download the PDF and send it yourself.",
                  "It can't be edited after this. Payments are recorded on this page.",
                ]}
                acknowledgment="I checked the PDF, the amounts and who it goes to."
                submitLabel="Issue invoice"
                pendingLabel="Issuing…"
              />
            </MoneyForm>
            <ConfirmAction
              action={voidQuickInvoice}
              trigger="Discard draft"
              title={`Discard draft #${invoice.number}?`}
              hidden={{ invoiceId: id, draft: "yes" }}
              reason={{ label: "Reason", placeholder: "Made by mistake…" }}
              effects={[`Draft #${invoice.number} is voided and kept on record with your reason. Its number isn't reused.`]}
              acknowledgment="Discard this draft."
              submitLabel="Discard draft"
              pendingLabel="Discarding…"
              recheckHref={href}
            />
          </section>
        )}

        {!draft && invoice.status !== "void" && (
          <section className="card space-y-3">
            <h2 className="font-semibold">Payments</h2>
            {invoice.status === "open" && <p className="text-xs text-muted">Record a payment you already received. This doesn&apos;t charge the customer.</p>}
            <ul className="space-y-2 text-sm">
              {invoice.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{formatDate(p.receivedOn)} · {formatCents(p.amountCents)} · {METHOD[p.method] ?? p.method}{p.reference && ` #${p.reference}`}</span>
                  <ConfirmAction
                    action={voidQuickPayment}
                    trigger="Void"
                    triggerClassName="text-xs underline"
                    title="Void this payment?"
                    hidden={{ invoiceId: id, paymentId: p.id }}
                    reason={{ label: "Reason", placeholder: "Check bounced…" }}
                    effects={[`The ${formatCents(p.amountCents)} payment stays on record as void, and the balance goes back up by that much.`]}
                    acknowledgment="Void this payment."
                    submitLabel="Void payment"
                    pendingLabel="Voiding…"
                    recheckHref={href}
                  />
                </li>
              ))}
              {invoice.payments.length === 0 && <li className="text-muted">No payments recorded yet.</li>}
            </ul>
            {invoice.status === "open" && (
              <MoneyForm action={recordQuickPayment} recheckHref={href} className="grid gap-2 sm:grid-cols-5 sm:items-end">
                <input type="hidden" name="invoiceId" value={id} />
                <label className="label"><span>Amount</span><input name="amount" required inputMode="decimal" defaultValue={(invoice.balanceCents / 100).toFixed(2)} className="input" /></label>
                <label className="label"><span>Method</span>
                  <select name="method" className="input">
                    {Object.entries(METHOD).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="label"><span>Check # / ref</span><input name="reference" className="input" /></label>
                <label className="label"><span>Received</span><input name="receivedOn" type="date" defaultValue={today} className="input" /></label>
                <Submit className="btn">Record payment</Submit>
              </MoneyForm>
            )}
          </section>
        )}

        {!draft && invoice.status !== "void" && (
          <section className="card space-y-3">
            <h2 className="font-semibold">Email it{invoice.sentAt ? " again" : ""}</h2>
            <MoneyForm action={sendQuickInvoice} recheckHref={href} className="space-y-3">
              <input type="hidden" name="invoiceId" value={id} />
              <label className="label">
                <span>To</span>
                <input type="email" name="sendTo" required defaultValue={invoice.sentTo ?? invoice.billTo.email ?? ""} className="input" />
              </label>
              <ConsequenceReview
                title="When you send it"
                effects={["The invoice PDF, with today's balance, is emailed 15 minutes from now."]}
                acknowledgment="Send this invoice to that address."
                submitLabel="Email invoice"
                pendingLabel="Queueing…"
              />
            </MoneyForm>
          </section>
        )}

        {member.role === "owner" && invoice.status === "open" && invoice.payments.length === 0 && (
          <section className="card space-y-2">
            <h2 className="font-semibold">Void this invoice</h2>
            <p className="text-sm text-muted">Use this to fix a mistake. Then make a new quick invoice with the right lines.</p>
            <ConfirmAction
              action={voidQuickInvoice}
              trigger="Void invoice"
              title={`Void invoice #${invoice.number}?`}
              hidden={{ invoiceId: id }}
              reason={{ label: "Reason", placeholder: "Wrong amount…" }}
              effects={[
                `Invoice #${invoice.number} for ${formatCents(invoice.totalCents)} is voided and stays on record with your reason.`,
                waiting ? "Its email hasn't gone out yet and won't." : invoice.sentAt ? `${invoice.billTo.name} already has it by email and isn't told it's void, so send them a note.` : "It was never emailed.",
              ]}
              acknowledgment={`Void invoice #${invoice.number}.`}
              submitLabel="Void invoice"
              pendingLabel="Voiding…"
              recheckHref={href}
            />
          </section>
        )}
      </WithRail>
    </>
  );
}
