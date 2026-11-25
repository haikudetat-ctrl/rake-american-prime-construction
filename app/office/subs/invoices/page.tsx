import Link from "next/link";
import { Empty } from "@/app/_ui/states";
import { StatusPill, type Tone } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { subQuery } from "@/lib/subcontract/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Unavailable } from "../../_unavailable";

const FILTERS = [
  { value: "open", label: "Outstanding" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Contractor paid" },
  { value: "all", label: "All invoices" },
] as const;

/** Contractor invoices (Figma V2 40): what each contractor still owes, and whether the email actually went. */
export default async function InvoicesPage({ searchParams }: PageProps<"/office/subs/invoices">) {
  await requireStaff();
  const query = await searchParams;
  const today = companyToday();
  const db = await createSupabaseServerClient();
  const status = query.status === "paid" || query.status === "overdue" || query.status === "all" ? query.status : "open";
  let request = db.from("sub_invoices").select("id, job_id, number, due_on, status, total_cents, sent_at, sub_contractors(name, billing), sub_jobs(address), sub_payments(amount_cents, voided_at)").order("due_on").limit(200);
  if (status !== "all") request = request.eq("status", status === "overdue" ? "open" : status);
  if (status === "overdue") request = request.lt("due_on", today);
  const { data, error } = await request;
  if (error) return <Unavailable area="Contractor invoices" />;
  const context = subQuery(query);
  const invoices = data ?? [];
  const owed = invoices
    .filter((i) => i.status === "open")
    .reduce((sum, i) => sum + i.total_cents - (i.sub_payments ?? []).filter((p) => !p.voided_at).reduce((t, p) => t + p.amount_cents, 0), 0);

  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow">Subcontracting · Invoices</p>
        <h1 className="page-title">Contractor invoices</h1>
        <p className="text-muted">
          {status === "open" || status === "overdue"
            ? `${invoices.length} ${invoices.length === 1 ? "invoice" : "invoices"} · ${formatCents(owed)} still owed. `
            : ""}
          Open one to see the job, record a payment or download the PDF.
        </p>
      </header>
      <nav aria-label="Invoice status" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link className={f.value === status ? "btn" : "btn-secondary"} aria-current={f.value === status ? "page" : undefined} key={f.value}
            href={`/office/subs/invoices${context || "?"}${context ? "&" : ""}status=${f.value}`}>{f.label}</Link>
        ))}
      </nav>
      {invoices.length === 0 && <Empty title="No invoices match this filter" />}
      <WorkList label="Contractor invoices" headings={["Invoice / contractor", "Job / balance"]}>
        {invoices.map((i) => {
          const paid = (i.sub_payments ?? []).filter((p) => !p.voided_at).reduce((sum, p) => sum + p.amount_cents, 0);
          const contractor = one(i.sub_contractors);
          const weekly = contractor?.billing !== "per_job";
          const state: { label: string; tone: Tone } =
            i.status === "void" ? { label: "Void", tone: "neutral" }
              : i.status === "paid" ? { label: "Paid", tone: "success" }
                : i.due_on < today ? { label: "Overdue", tone: "danger" }
                  : { label: "Outstanding", tone: "warning" };
          // Weekly contractors get one statement, not an email per invoice.
          const delivery = i.status === "void" ? null : weekly ? "on the weekly statement" : i.sent_at ? "emailed" : "not emailed yet";
          return (
            <WorkRow
              key={i.id}
              href={`/office/subs/${i.job_id}${context}`}
              title={`#${i.number} · ${contractor?.name ?? "Contractor"}`}
              detail={`${one(i.sub_jobs)?.address ?? ""} · ${i.status === "void" ? "voided" : "balance"} ${formatCents(i.status === "void" ? i.total_cents : i.total_cents - paid)} · due ${formatDate(i.due_on)}${delivery ? ` · ${delivery}` : ""}`}
              aside={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
            />
          );
        })}
      </WorkList>
      {invoices.length === 200 && <p className="text-xs text-muted">Showing the first 200, earliest due first.</p>}
    </>
  );
}
