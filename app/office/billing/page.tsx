import Link from "next/link";
import { issueStatementsNow } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Unavailable } from "@/app/office/_unavailable";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
import { StatusPill, type Tone } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Dumpster billing (Figma V2 54): what is ready to bill, what is stuck, and the statements already out. */
export default async function BillingPage({ searchParams }: PageProps<"/office/billing">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: unbilled, error: unbilledError }, { data: statements, error: statementsError }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, status, total_cents, rental_id, customer_id, customers(name, billing_email), rentals(status, sites(address))")
      .in("status", ["draft", "final"])
      .order("number"),
    supabase
      .from("statements")
      .select("id, number, issued_on, due_on, total_cents, status, sent_at, customers(name, billing_email), payments(amount_cents)")
      .order("issued_on", { ascending: false })
      .limit(100),
  ]);
  if (unbilledError || statementsError) return <Unavailable eyebrow="Office · Dumpster billing" area="Ready for billing" />;
  const today = companyToday();
  const ready = (unbilled ?? []).filter((i) => i.status === "final");
  const open = (unbilled ?? []).filter((i) => i.status === "draft");
  const readyCents = ready.reduce((sum, i) => sum + i.total_cents, 0);
  // What "Issue statements now" would bill if confirmed right now: one statement per customer.
  const byCustomer = [...ready.reduce((m, i) => {
    const c = one(i.customers);
    const entry = m.get(i.customer_id) ?? { id: i.customer_id, name: c?.name ?? "Customer", email: c?.billing_email?.trim() || null, cents: 0, count: 0 };
    entry.cents += i.total_cents;
    entry.count += 1;
    return m.set(i.customer_id, entry);
  }, new Map<string, { id: string; name: string; email: string | null; cents: number; count: number }>()).values()];
  const noEmail = byCustomer.filter((c) => !c.email);
  const rentalOf = (i: (typeof open)[number]) => one(i.rentals) as { status: string; sites: { address: string } | { address: string }[] | null } | null;
  const needsTicket = open.filter((i) => rentalOf(i)?.status === "picked_up").length;

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Office · Dumpster billing</p>
        <h1 className="page-title">Ready for billing</h1>
        <p className="text-muted">Statements go out automatically every Monday morning. Issue them now to bill sooner.</p>
      </header>

      <WithRail
        rail={
          <>
            <RailCard title="How billing works">
              <p>A rental is ready to bill once its scale ticket is in. Each Monday, every customer with ready rentals gets one statement.</p>
              <p className="text-xs text-muted">Issuing locks those invoices. Fixing one later means an owner voids the statement before any payment is recorded.</p>
            </RailCard>
            <p className="px-3 text-xs text-muted">
              <Link className="underline" href="/office/customers">Customers and billing emails</Link>
            </p>
            <p className="px-3 text-xs text-muted">
              A one-off charge that isn&apos;t a rental? <Link className="underline" href="/office/invoices/new">Make a quick invoice</Link>. It stays off the Monday statement.
            </p>
          </>
        }
      >
        <section aria-labelledby="ready" className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="ready" className="text-base">
              Ready to bill <span className="font-normal text-muted">{ready.length ? `${formatCents(readyCents)} · ${byCustomer.length === 1 ? "1 customer" : `${byCustomer.length} customers`}` : ""}</span>
            </h2>
            {ready.length > 0 && (
              <ConfirmAction
                action={issueStatementsNow}
                trigger="Issue statements now"
                triggerClassName="btn"
                title="Issue statements now?"
                effects={[
                  `A statement goes to each customer with invoices ready to bill when you confirm. Right now that is ${byCustomer.length === 1 ? "1 customer" : `${byCustomer.length} customers`} for ${formatCents(readyCents)}: ${byCustomer.map((c) => `${c.name} ${formatCents(c.cents)}`).join(", ")}.`,
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
          {byCustomer.length === 0 ? (
            <Empty title="Nothing waiting to be billed">Rentals show up here once their scale ticket is entered.</Empty>
          ) : (
            <WorkList label="Ready to bill" headings={["Customer", "Ready to bill"]}>
              {byCustomer.map((c) => (
                <WorkRow
                  key={c.id}
                  href={`/office/customers/${c.id}`}
                  title={c.name}
                  detail={`${c.count === 1 ? "1 completed rental" : `${c.count} completed rentals`} ready · ${formatCents(c.cents)}${c.email ? "" : " · no billing email, send it yourself"}`}
                  aside={c.email ? undefined : <StatusPill tone="warning">No email</StatusPill>}
                />
              ))}
            </WorkList>
          )}
        </section>

        <section aria-labelledby="on-job" className="space-y-2.5">
          <h2 id="on-job" className="text-base">
            Not ready yet <span className="font-normal text-muted">{open.length ? `${formatCents(open.reduce((sum, i) => sum + i.total_cents, 0))} so far` : ""}</span>
          </h2>
          <p className="text-sm text-muted">
            These finish when the scale ticket is entered.{needsTicket ? ` ${needsTicket === 1 ? "1 can is" : `${needsTicket} cans are`} back and waiting on a ticket.` : ""}
          </p>
          {open.length === 0 ? (
            <Empty title="No cans out" />
          ) : (
            <WorkList label="Not ready yet">
              {open.map((i) => {
                const rental = rentalOf(i);
                const back = rental?.status === "picked_up";
                return (
                  <WorkRow
                    key={i.id}
                    href={`/office/rentals/${i.rental_id}`}
                    title={`#${i.number} · ${one(i.customers)?.name ?? "Customer"}`}
                    detail={`${one(rental?.sites)?.address ?? ""} · ${formatCents(i.total_cents)} so far`}
                    action={back ? "Enter ticket" : undefined}
                    aside={<StatusPill tone={back ? "warning" : "neutral"}>{back ? "Needs ticket" : "Can out"}</StatusPill>}
                  />
                );
              })}
            </WorkList>
          )}
        </section>

        <section aria-labelledby="statements" className="space-y-2.5">
          <h2 id="statements" className="text-base">Issued statements</h2>
          {(statements ?? []).length === 0 ? (
            <Empty title="No statements yet" />
          ) : (
            <WorkList label="Issued statements" headings={["Statement / customer", "Dates / balance"]}>
              {(statements ?? []).map((s) => {
                const paid = (s.payments ?? []).reduce((sum: number, p: { amount_cents: number }) => sum + p.amount_cents, 0);
                const customer = one(s.customers);
                const state: { label: string; tone: Tone } =
                  s.status === "void" ? { label: "Void", tone: "neutral" }
                    : s.status === "paid" ? { label: "Paid", tone: "success" }
                      : s.due_on < today ? { label: "Overdue", tone: "danger" }
                        : { label: "Open", tone: "warning" };
                const delivery = s.status === "void" ? "" : s.sent_at ? " · emailed" : customer?.billing_email?.trim() ? " · not emailed yet" : " · no billing email";
                return (
                  <WorkRow
                    key={s.id}
                    href={`/office/billing/${s.id}`}
                    title={`#${s.number} · ${customer?.name ?? "Customer"}`}
                    detail={`Issued ${formatDate(s.issued_on)} · due ${formatDate(s.due_on)} · ${s.status === "void" ? `voided ${formatCents(s.total_cents)}` : `balance ${formatCents(s.total_cents - paid)}`}${delivery}`}
                    aside={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
                  />
                );
              })}
            </WorkList>
          )}
          {(statements ?? []).length === 100 && <p className="text-xs text-muted">Showing the 100 most recent.</p>}
        </section>
      </WithRail>
    </>
  );
}
