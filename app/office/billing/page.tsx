import Link from "next/link";
import { issueStatementsNow } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function BillingPage({ searchParams }: PageProps<"/office/billing">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: unbilled }, { data: statements }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, status, total_cents, rental_id, customer_id, customers(name, billing_email), rentals(sites(address))")
      .in("status", ["draft", "final"])
      .order("number"),
    supabase
      .from("statements")
      .select("id, number, issued_on, due_on, total_cents, status, sent_at, customers(name), payments(amount_cents)")
      .order("issued_on", { ascending: false })
      .limit(100),
  ]);
  const today = companyToday();
  const ready = (unbilled ?? []).filter((i) => i.status === "final");
  const open = (unbilled ?? []).filter((i) => i.status === "draft");
  // What "Issue statements now" would bill if confirmed right now: one statement per customer.
  const byCustomer = [...ready.reduce((m, i) => {
    const c = one(i.customers);
    const entry = m.get(i.customer_id) ?? { name: c?.name ?? "Customer", email: c?.billing_email?.trim() || null, cents: 0, count: 0 };
    entry.cents += i.total_cents;
    entry.count += 1;
    return m.set(i.customer_id, entry);
  }, new Map<string, { name: string; email: string | null; cents: number; count: number }>()).values()];
  const noEmail = byCustomer.filter((c) => !c.email);

  return (
    <>
      <Notice searchParams={params} />
      <h1 className="page-title">Dumpster billing</h1>
      <p className="text-sm text-muted">
        Statements go out automatically every Monday morning. Use the button to send one now.
      </p>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            Ready to bill · {formatCents(ready.reduce((sum, i) => sum + i.total_cents, 0))}
          </h2>
          {ready.length > 0 && (
            <ConfirmAction
              action={issueStatementsNow}
              trigger="Issue statements now"
              triggerClassName="btn"
              title="Issue statements now?"
              effects={[
                `A statement goes to each customer with invoices ready to bill when you confirm. Right now that is ${byCustomer.length === 1 ? "1 customer" : `${byCustomer.length} customers`} for ${formatCents(ready.reduce((sum, i) => sum + i.total_cents, 0))}: ${byCustomer.map((c) => `${c.name} ${formatCents(c.cents)}`).join(", ")}.`,
                noEmail.length === byCustomer.length
                  ? "None of them has a billing email, so nothing is emailed; download each statement from its page to send it."
                  : `Customers with a billing email get it by email right away${noEmail.length ? `. ${noEmail.map((c) => c.name).join(", ")} ${noEmail.length === 1 ? "has" : "have"} no billing email, so download and send ${noEmail.length === 1 ? "that one" : "those"} yourself` : ""}.`,
                "These invoices can't be changed after this. Fixing one means an owner voids its statement, before any payment is recorded.",
                "If QuickBooks sync is on, the invoices go to QuickBooks on its next run.",
              ]}
              acknowledgment="Bill these customers now instead of waiting for Monday."
              submitLabel="Issue statements"
              pendingLabel="Issuing…"
              recheckHref="/office/billing"
            />
          )}
        </div>
        <InvoiceTable rows={ready} empty="Nothing waiting to be billed." />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">
          Still on a job · {formatCents(open.reduce((sum, i) => sum + i.total_cents, 0))} so far
        </h2>
        <p className="text-sm text-muted">These finish when the scale ticket is entered.</p>
        <InvoiceTable rows={open} empty="No cans out." />
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Statements</h2>
        <table className="table">
          <thead><tr><th>#</th><th>Customer</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>
            {(statements ?? []).map((s) => {
              const paid = (s.payments ?? []).reduce((sum: number, p: { amount_cents: number }) => sum + p.amount_cents, 0);
              const overdue = s.status === "open" && s.due_on < today;
              return (
                <tr key={s.id}>
                  <td><Link className="underline" href={`/office/billing/${s.id}`}>{s.number}</Link></td>
                  <td>{one(s.customers)?.name}</td>
                  <td>{formatDate(s.issued_on)}</td>
                  <td className={overdue ? "font-semibold text-danger" : ""}>{formatDate(s.due_on)}</td>
                  <td>{formatCents(s.total_cents)}</td>
                  <td>{formatCents(s.total_cents - paid)}</td>
                  <td>{overdue ? "overdue" : s.status === "void" ? <span className="text-muted">void</span> : s.status}{!s.sent_at && s.status === "open" && <span className="ml-1 text-xs text-muted">(not emailed)</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

type InvoiceRow = {
  id: string;
  number: number;
  rental_id: string;
  total_cents: number;
  customers: { name: string } | { name: string }[] | null;
  rentals: { sites: { address: string } | { address: string }[] | null } | { sites: unknown }[] | null;
};

function InvoiceTable({ rows, empty }: { rows: InvoiceRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Invoice</th><th>Customer</th><th>Address</th><th>Amount</th></tr></thead>
        <tbody>
          {rows.map((i) => {
            const rental = one(i.rentals) as { sites: { address: string } | { address: string }[] | null } | null;
            return (
              <tr key={i.id}>
                <td><Link className="underline" href={`/office/rentals/${i.rental_id}`}>#{i.number}</Link></td>
                <td>{one(i.customers)?.name}</td>
                <td>{one(rental?.sites)?.address}</td>
                <td>{formatCents(i.total_cents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
