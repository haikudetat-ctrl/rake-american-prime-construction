import Link from "next/link";
import { issueSubStatement } from "@/app/office/subs/actions";
import { Notice } from "@/app/office/_notice";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { periodText } from "@/lib/subcontract/view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Unavailable } from "../../_unavailable";

type Waiting = { contractorId: string; name: string; email: string | null; terms: number; jobs: number; totalCents: number; first: string; last: string };

/**
 * Weekly billing for subcontracting: what each weekly contractor has waiting
 * (it goes out Monday on its own, or now from here), and the statements sent.
 */
export default async function SubStatementsPage({ searchParams }: PageProps<"/office/subs/statements">) {
  await requireStaff();
  const query = await searchParams;
  const today = companyToday();
  const db = await createSupabaseServerClient();
  const [{ data: waitingRows, error: waitingError }, { data: statements, error: statementError }] = await Promise.all([
    db.from("sub_invoices")
      .select("total_cents, sub_contractors!inner(id, name, billing, billing_email, payment_terms_days), sub_jobs!inner(work_date)")
      .eq("status", "open").is("statement_id", null).eq("sub_contractors.billing", "weekly"),
    db.from("sub_statements")
      .select("id, number, issued_on, due_on, period_start, period_end, total_cents, status, sent_at, sub_contractors(name), sub_invoices(sub_payments(amount_cents, voided_at))")
      .order("issued_on", { ascending: false }).order("number", { ascending: false }).limit(100),
  ]);
  if (waitingError || statementError) return <Unavailable area="Statements" />;

  const waiting = new Map<string, Waiting>();
  for (const row of waitingRows ?? []) {
    const gc = one(row.sub_contractors)!;
    const date = one(row.sub_jobs)!.work_date as string;
    const w = waiting.get(gc.id) ?? { contractorId: gc.id, name: gc.name, email: gc.billing_email, terms: gc.payment_terms_days, jobs: 0, totalCents: 0, first: date, last: date };
    w.jobs += 1;
    w.totalCents += row.total_cents;
    if (date < w.first) w.first = date;
    if (date > w.last) w.last = date;
    waiting.set(gc.id, w);
  }
  const ready = [...waiting.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Notice searchParams={query} />
      <header>
        <p className="eyebrow">Subcontracting</p>
        <h1 className="page-title">Statements</h1>
        <p className="text-muted">
          Contractors billed weekly get one statement for all their closed jobs. It goes out every Monday for the week
          before; send one now if they need it sooner.
        </p>
      </header>

      <section className="card space-y-3">
        <h2 className="font-semibold">Waiting for a statement</h2>
        {ready.length === 0 && <p className="text-sm text-muted">Nothing waiting. Closed jobs for weekly contractors show up here.</p>}
        <ul className="space-y-3">
          {ready.map((w) => (
            <li key={w.contractorId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
              <div>
                <p className="font-medium">{w.name}</p>
                <p className="text-sm text-muted">
                  {w.jobs} {w.jobs === 1 ? "job" : "jobs"} · {periodText(w.first, w.last)} · <span className="font-semibold text-foreground">{formatCents(w.totalCents)}</span>
                </p>
              </div>
              <ConfirmAction
                action={issueSubStatement}
                trigger="Send statement now"
                title={`Bill ${w.name} now?`}
                hidden={{ contractorId: w.contractorId }}
                effects={[
                  `One statement for ${w.jobs} ${w.jobs === 1 ? "job" : "jobs"} (${periodText(w.first, w.last)}), ${formatCents(w.totalCents)}, due ${formatDate(addDays(today, w.terms))}.`,
                  w.email
                    ? `It emails to ${w.email} right away, with a PDF listing every job.`
                    : `${w.name} has no billing email on file, so nothing is emailed; download the PDF from the statement.`,
                  "Jobs closed after this go on the next statement.",
                ]}
                acknowledgment={`Send ${w.name} the statement.`}
                submitLabel="Send statement"
                pendingLabel="Sending…"
                recheckHref="/office/subs/statements"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Sent</h2>
        {(statements ?? []).length === 0 && <p className="card text-sm text-muted">No statements yet.</p>}
        <ul className="space-y-3">
          {(statements ?? []).map((s) => {
            const paid = (s.sub_invoices ?? []).flatMap((i) => i.sub_payments ?? []).filter((p) => !p.voided_at).reduce((sum, p) => sum + p.amount_cents, 0);
            const overdue = s.status === "open" && s.due_on < today;
            return (
              <li key={s.id}>
                <Link href={`/office/subs/statements/${s.id}`} className={`card block space-y-1 hover:border-brand ${s.status === "void" ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">#{s.number} · {one(s.sub_contractors)?.name}</span>
                    <span className={`pill ${overdue ? "border-danger text-danger" : ""}`}>
                      {s.status === "void" ? "Void" : s.status === "paid" ? "Paid" : overdue ? "Overdue" : "Open"}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    Work {periodText(s.period_start, s.period_end)} · issued {formatDate(s.issued_on)} · due {formatDate(s.due_on)} ·{" "}
                    {s.status === "void" ? `was ${formatCents(s.total_cents)}` : `${formatCents(s.total_cents - paid)} of ${formatCents(s.total_cents)} owed`}
                    {s.status !== "void" && !s.sent_at && " · not emailed"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
