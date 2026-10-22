import { Submit } from "./_submit";
import { Unavailable } from "../_unavailable";
import { subQuery } from "@/lib/subcontract/navigation";
import Link from "next/link";
import { createSubJob } from "@/app/office/subs/actions";
import { CrewPicker, STATUS_LABEL } from "@/app/office/subs/_parts";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate, weekStart } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Subcontracting, one week at a time: add the day's jobs in the morning,
 * close each one when it's done. Closing bills the contractor; the week's
 * closed jobs are the payroll.
 */
export default async function SubsPage({ searchParams }: PageProps<"/office/subs">) {
  await requireStaff();
  const query = await searchParams;
  const today = companyToday();
  const week = typeof query.week === "string" && ISO.test(query.week) ? weekStart(query.week) : weekStart(today);
  const end = addDays(week, 7);
  const supabase = await createSupabaseServerClient();

  const [{ data: contractors, error: contractorsError }, { data: workers, error: workersError }, { data: jobs, error: jobsError }, { data: open, error: invoicesError }] = await Promise.all([
    supabase.from("sub_contractors").select("id, name").eq("is_active", true).order("name"),
    supabase.from("sub_workers").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("sub_jobs")
      .select("id, work_date, address, status, squares, pitch, bill_total_cents, pay_total_cents, sub_contractors(name), sub_job_crew(sub_workers(name)), sub_invoices(number, status)")
      .gte("work_date", week)
      .lt("work_date", end)
      .order("work_date")
      .order("created_at"),
    supabase.from("sub_invoices").select("total_cents, sub_payments(amount_cents, voided_at)").eq("status", "open"),
  ]);

  if (contractorsError || workersError || jobsError || invoicesError) return <Unavailable />;
  const filter = query.filter === "scheduled" || query.filter === "done" ? query.filter : "all";
  const returnQuery = subQuery({ week, filter });
  const rows = jobs ?? [];
  const visible = rows.filter(j => filter === "all" || j.status === filter);
  const closed = rows.filter((j) => j.status === "done");
  const billed = closed.reduce((s, j) => s + (j.bill_total_cents ?? 0), 0);
  const crew = closed.reduce((s, j) => s + (j.pay_total_cents ?? 0), 0);
  const squares = closed.reduce((s, j) => s + Number(j.squares ?? 0), 0);
  const stillOpen = rows.filter((j) => j.status === "scheduled" && j.work_date <= today).length;
  const owed = (open ?? []).reduce(
    (s, inv) => s + inv.total_cents - (inv.sub_payments ?? []).filter((p) => !p.voided_at).reduce((t, p) => t + p.amount_cents, 0),
    0,
  );
  const days = [...new Set(visible.map((j) => j.work_date))];
  const ready = (contractors ?? []).length > 0 && (workers ?? []).length > 0;

  return (
    <>
      <Notice searchParams={query} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Subcontracting</p>
          <h1 className="page-title">Week of {formatDate(week)}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href={`/office/subs${subQuery({ week: addDays(week, -7), filter })}`}>← Prev</Link>
          <Link className="btn-secondary" href="/office/subs">This week</Link>
          <Link className="btn-secondary" href={`/office/subs${subQuery({ week: addDays(week, 7), filter })}`}>Next →</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card-stripe">
          <p className="eyebrow">Billed</p>
          <p className="stat-value">{formatCents(billed)}</p>
          <p className="text-xs text-muted">{closed.length} closed · {Math.round(squares * 100) / 100} sq</p>
        </div>
        <div className="card-stripe">
          <p className="eyebrow">Crew pay earned</p>
          <p className="stat-value">{formatCents(crew)}</p>
          <p className="text-xs text-muted"><Link className="underline" href={`/office/subs/payroll${returnQuery}`}>Earned by person</Link></p>
        </div>
        <div className="card-stripe">
          <p className="eyebrow">Billed less crew</p>
          <p className="stat-value">{formatCents(billed - crew)}</p>
          <p className="text-xs text-muted">{billed ? `${Math.round(((billed - crew) / billed) * 100)}% of billed` : "after crew pay"}</p>
        </div>
        <div className="card-stripe">
          <p className="eyebrow">Contractors owe</p>
          <p className="stat-value">{formatCents(owed)}</p>
          <p className="text-xs text-muted">all open invoices</p>
        </div>
      </div>

      {stillOpen > 0 && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          {stillOpen} {stillOpen === 1 ? "job is" : "jobs are"} still open from today or earlier. Close {stillOpen === 1 ? "it" : "them"} so the contractor
          gets billed and the crew has earnings recorded.
        </p>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Assign jobs</h2>
        {!ready ? (
          <p className="text-sm text-muted">
            Add the contractors you work for and your crew in <Link className="underline" href="/office/subs/setup">Setup</Link> first.
          </p>
        ) : (
          <form action={createSubJob} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="label">
                <span>Day</span>
                <input name="workDate" type="date" required defaultValue={week === weekStart(today) ? today : week} className="input" />
              </label>
              <label className="label sm:col-span-2">
                <span>Contractor</span>
                <select name="contractorId" required className="input" defaultValue="">
                  <option value="" disabled>Pick one</option>
                  {(contractors ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
            <label className="label">
              <span>Address</span>
              <input name="address" required autoComplete="off" placeholder="232 Hewitt St, Trenton" className="input" />
            </label>
            <CrewPicker workers={workers ?? []} />
            <label className="label">
              <span>Notes (optional)</span>
              <input name="notes" placeholder="Gate code, tear-off layers, who's leading…" className="input" />
            </label>
            <Submit className="btn w-full sm:w-auto">Assign job</Submit>
          </form>
        )}
      </section>

      <nav aria-label="Job status filter" className="flex flex-wrap gap-2">{[{ value: 'all', label: 'All work' }, { value: 'scheduled', label: 'Needs finishing' }, { value: 'done', label: 'Work complete' }].map(f => <Link key={f.value} className={filter === f.value ? 'btn' : 'btn-secondary'} aria-current={filter === f.value ? 'page' : undefined} href={`/office/subs${subQuery({ week, filter: f.value })}`}>{f.label}</Link>)}</nav>
      {visible.length === 0 && <p className="card text-muted">No jobs match this week and filter.</p>}

      {days.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="font-semibold">{formatDate(day)}{day === today && <span className="ml-2 pill">Today</span>}</h2>
          <ul className="space-y-2">
            {visible.filter((j) => j.work_date === day).map((job) => {
              const invoice = (job.sub_invoices ?? []).find((i) => i.status !== "void");
              const names = (job.sub_job_crew ?? []).map((c) => one(c.sub_workers)?.name ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b));
              return (
                <li key={job.id}>
                  <Link href={`/office/subs/${job.id}${returnQuery}`} className={`card block hover:border-brand ${job.status === "void" ? "opacity-50" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{job.address}</p>
                        <p className="text-sm text-muted">{one(job.sub_contractors)?.name} · {names.length ? names.join(", ") : "no crew yet"}</p>
                      </div>
                      <span className={`pill ${job.status === "scheduled" ? "border-warn text-warn" : ""}`}>{STATUS_LABEL[job.status]}</span>
                    </div>
                    {job.status === "scheduled" && <p className="mt-3 text-sm font-semibold text-accent">{names.length ? "Review and finish job →" : "Assign crew →"}</p>}
                    {job.status === "done" && (
                      <p className="mt-2 text-sm">
                        {Number(job.squares)} sq at {job.pitch}/12 · billed {formatCents(job.bill_total_cents)}
                        {invoice && <> · invoice #{invoice.number}: {invoice.status === "paid" ? "contractor paid" : "payment outstanding"}</>} · crew earnings {formatCents(job.pay_total_cents)}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="text-sm text-muted">
        <Link className="underline" href={`/office/subs/payroll${returnQuery}`}>Crew earnings for this week</Link> ·{" "}
        <Link className="underline" href="/office/subs/setup">Setup: contractors, crew, rates</Link>
      </p>
    </>
  );
}
