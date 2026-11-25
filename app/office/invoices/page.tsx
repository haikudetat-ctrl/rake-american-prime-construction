import Link from "next/link";
import { Notice } from "@/app/office/_notice";
import { Unavailable } from "@/app/office/_unavailable";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { quickState, type QuickStatus } from "@/lib/billing/quick-invoice";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Row = {
  id: string; number: number; status: QuickStatus; bill_to_name: string; issued_on: string | null; due_on: string; created_at: string;
  total_cents: number; brands: { display_name: string } | { display_name: string }[] | null;
  quick_invoice_payments: { amount_cents: number; voided_at: string | null }[] | null;
};

const balance = (r: Row) => r.total_cents - (r.quick_invoice_payments ?? []).filter((p) => !p.voided_at).reduce((s, p) => s + p.amount_cents, 0);

/** Quick invoices: drafts to finish, what's still owed, and the last 100 paid or voided. */
export default async function QuickInvoicesPage({ searchParams }: PageProps<"/office/invoices">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const select = "id, number, status, bill_to_name, issued_on, due_on, created_at, total_cents, brands(display_name), quick_invoice_payments(amount_cents, voided_at)";
  const [{ data: live, error: liveError }, { data: closed, error: closedError }] = await Promise.all([
    supabase.from("quick_invoices").select(select).in("status", ["draft", "open"]).order("number", { ascending: false }).limit(500),
    supabase.from("quick_invoices").select(select).in("status", ["paid", "void"]).order("number", { ascending: false }).limit(100),
  ]);
  if (liveError || closedError) return <Unavailable eyebrow="Office · Invoices" area="Quick invoices" />;
  const today = companyToday();
  const rows = (live ?? []) as unknown as Row[];
  const drafts = rows.filter((r) => r.status === "draft");
  const open = rows.filter((r) => r.status === "open").sort((a, b) => a.due_on.localeCompare(b.due_on));
  const owed = open.reduce((s, r) => s + balance(r), 0);
  const overdue = open.filter((r) => r.due_on < today).reduce((s, r) => s + balance(r), 0);

  const row = (r: Row) => {
    const state = quickState({ status: r.status, dueOn: r.due_on }, today);
    const brand = one(r.brands)?.display_name;
    const detail =
      r.status === "draft" ? `Started ${formatDate(companyToday(new Date(r.created_at)))} · ${formatCents(r.total_cents)}`
        : r.status === "open" ? `Due ${formatDate(r.due_on)} · ${formatCents(balance(r))} owed`
          : r.status === "paid" ? `Issued ${formatDate(r.issued_on ?? r.due_on)} · ${formatCents(r.total_cents)} paid`
            : `Voided · ${formatCents(r.total_cents)}`;
    return (
      <WorkRow key={r.id} href={`/office/invoices/${r.id}`} title={`#${r.number} · ${r.bill_to_name}`}
        detail={[detail, brand].filter(Boolean).join(" · ")} aside={<StatusPill tone={state.tone}>{state.label}</StatusPill>} />
    );
  };

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Office · Invoices</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">Quick invoices</h1>
          <Link className="btn ml-auto" href="/office/invoices/new">New quick invoice</Link>
        </div>
        <p className="text-muted">{open.length ? `${formatCents(owed)} owed on ${open.length === 1 ? "1 invoice" : `${open.length} invoices`}${overdue ? `, ${formatCents(overdue)} of it overdue` : ""}.` : "Nothing owed on quick invoices right now."}</p>
      </header>
      <WithRail
        rail={
          <RailCard title="Other invoices">
            <p className="text-xs text-muted">Dumpster rentals bill on the Monday statement and contractor jobs bill when they close. Those live in their own workspaces.</p>
            <p className="text-xs"><Link className="underline" href="/office/billing">Dumpster billing</Link> · <Link className="underline" href="/office/subs/invoices">Contractor invoices</Link></p>
          </RailCard>
        }
      >
        {drafts.length > 0 && (
          <section aria-labelledby="drafts" className="space-y-2.5">
            <h2 id="drafts" className="text-base">Drafts <span className="font-normal text-muted">not sent to anyone yet</span></h2>
            <WorkList label="Drafts">{drafts.map(row)}</WorkList>
          </section>
        )}
        <section aria-labelledby="owed" className="space-y-2.5">
          <h2 id="owed" className="text-base">Owed <span className="font-normal text-muted">{open.length ? formatCents(owed) : ""}</span></h2>
          {open.length === 0 ? <Empty title="Nothing owed">Issued quick invoices show here until they&apos;re paid.</Empty> : <WorkList label="Owed" headings={["Invoice", "Due / balance"]}>{open.map(row)}</WorkList>}
        </section>
        {(closed ?? []).length > 0 && (
          <section aria-labelledby="closed" className="space-y-2.5">
            <h2 id="closed" className="text-base">Paid and voided</h2>
            <WorkList label="Paid and voided">{((closed ?? []) as unknown as Row[]).map(row)}</WorkList>
            {(closed ?? []).length === 100 && <p className="text-xs text-muted">Showing the 100 most recent.</p>}
          </section>
        )}
      </WithRail>
    </>
  );
}
