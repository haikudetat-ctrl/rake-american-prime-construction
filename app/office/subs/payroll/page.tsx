import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate, weekStart } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { payrollByWorker, pitchLabel, type PayrollRow } from "@/lib/subcontract/view";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sunday's payroll: every closed job in the week (Monday to Sunday), per
 * person, with what each one is owed and for which roofs. This is the page
 * that replaces going back through the WhatsApp groups.
 */
export default async function PayrollPage({ searchParams }: PageProps<"/office/subs/payroll">) {
  await requireStaff();
  const query = await searchParams;
  const week = typeof query.week === "string" && ISO.test(query.week) ? weekStart(query.week) : weekStart(companyToday());
  const end = addDays(week, 7);
  const supabase = await createSupabaseServerClient();

  const [{ data: shares }, { count: stillOpen }] = await Promise.all([
    supabase
      .from("sub_job_crew")
      .select("worker_id, pay_cents, sub_workers(name), sub_jobs!inner(id, work_date, address, squares, pitch, status, sub_contractors(name), sub_job_crew(worker_id))")
      .eq("sub_jobs.status", "done")
      .gte("sub_jobs.work_date", week)
      .lt("sub_jobs.work_date", end),
    supabase.from("sub_jobs").select("id", { count: "exact", head: true }).eq("status", "scheduled").gte("work_date", week).lt("work_date", end),
  ]);

  const rows: PayrollRow[] = (shares ?? []).map((s) => {
    const job = one(s.sub_jobs)!;
    return {
      workerId: s.worker_id,
      workerName: one(s.sub_workers)?.name ?? "",
      jobId: job.id,
      workDate: job.work_date,
      address: job.address,
      contractor: one(job.sub_contractors)?.name ?? "",
      squares: Number(job.squares),
      pitch: job.pitch ?? 0,
      crewSize: (job.sub_job_crew ?? []).length,
      payCents: s.pay_cents ?? 0,
    };
  });
  const { workers, totalCents } = payrollByWorker(rows);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Subcontracting payroll</p>
          <h1 className="page-title">{formatDate(week)} – {formatDate(addDays(week, 6))}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href={`/office/subs/payroll?week=${addDays(week, -7)}`}>← Prev</Link>
          <Link className="btn-secondary" href={`/office/subs/payroll?week=${addDays(week, 7)}`}>Next →</Link>
        </div>
      </div>
      <p className="text-sm">
        <Link className="underline" href={`/office/subs?week=${week}`}>← Jobs for this week</Link>
      </p>

      {(stillOpen ?? 0) > 0 && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          {stillOpen} {stillOpen === 1 ? "job" : "jobs"} this week {stillOpen === 1 ? "isn't" : "aren't"} closed yet, so{" "}
          {stillOpen === 1 ? "it's" : "they're"} not in these totals. <Link className="underline" href={`/office/subs?week=${week}`}>Close them</Link> first.
        </p>
      )}

      <div className="card-stripe">
        <p className="eyebrow">Payroll this week</p>
        <p className="stat-value">{formatCents(totalCents)}</p>
        <p className="text-xs text-muted">{workers.length} {workers.length === 1 ? "person" : "people"} · {new Set(rows.map((r) => r.jobId)).size} jobs</p>
      </div>

      {workers.length === 0 && <p className="card text-muted">No closed jobs this week.</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {workers.map((w) => (
          <section key={w.workerId} className="card space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{w.name}</h2>
              <p className="text-lg font-semibold">{formatCents(w.totalCents)}</p>
            </div>
            <table className="table">
              <tbody>
                {w.jobs.map((j) => (
                  <tr key={j.jobId}>
                    <td className="whitespace-nowrap">{formatDate(j.workDate)}</td>
                    <td>
                      <Link className="underline" href={`/office/subs/${j.jobId}`}>{j.address}</Link>
                      <div className="text-xs text-muted">
                        {j.contractor} · {j.squares} sq at {pitchLabel(j.pitch)} · split {j.crewSize} ways
                      </div>
                    </td>
                    <td className="text-right">{formatCents(j.payCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  );
}
