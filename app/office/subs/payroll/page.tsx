import { subQuery } from "@/lib/subcontract/navigation";
import { Unavailable } from "../../_unavailable";
import Link from "next/link";
import { Callout } from "@/app/_ui/callout";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
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

  const [{ data: shares, error: sharesError }, { count: stillOpen, error: jobsError }] = await Promise.all([
    supabase
      .from("sub_job_crew")
      .select("worker_id, pay_cents, sub_workers(name), sub_jobs!inner(id, work_date, address, squares, pitch, status, sub_contractors(name), sub_job_crew(worker_id))")
      .eq("sub_jobs.status", "done")
      .gte("sub_jobs.work_date", week)
      .lt("sub_jobs.work_date", end),
    supabase.from("sub_jobs").select("id", { count: "exact", head: true }).eq("status", "scheduled").gte("work_date", week).lt("work_date", end),
  ]);

  if (sharesError || jobsError) return <Unavailable area="Weekly crew earnings" />;
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

  const jobs = new Set(rows.map((r) => r.jobId)).size;
  const back = `/office/subs${subQuery({ week, filter: query.filter })}`;

  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow">Subcontracting · Crew earnings</p>
        <h1 className="page-title">Weekly crew earnings</h1>
        <p className="text-muted">{formatDate(week)} to {formatDate(addDays(week, 6))}</p>
      </header>
      <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
        <Link className="btn-secondary" href={`/office/subs/payroll?week=${addDays(week, -7)}`}>‹ Previous week</Link>
        <Link className="btn-secondary" href={`/office/subs/payroll?week=${addDays(week, 7)}`}>Next week ›</Link>
        <Link className="btn-secondary" href={back}>Jobs for this week</Link>
      </nav>

      <WithRail
        rail={
          <RailCard title="How this total works">
            <p>Finished jobs only, Monday through Sunday. Each job&apos;s crew pay is split equally between the people on it; leftover cents go one each to the first names in order.</p>
            <p>This is a record of what each person earned. It doesn&apos;t pay anyone, track whether they were paid, or work out taxes.</p>
          </RailCard>
        }
      >
        <section className="space-y-1 rounded-card border border-border/60 bg-surface p-4 sm:p-5">
          <p className="text-2xl font-bold">{formatCents(totalCents)} earned</p>
          <p className="text-sm text-muted">
            {workers.length} {workers.length === 1 ? "person" : "people"} · {jobs} finished {jobs === 1 ? "job" : "jobs"}
          </p>
        </section>

        {(stillOpen ?? 0) > 0 && (
          <Callout tone="warning" title={`${stillOpen} ${stillOpen === 1 ? "job this week isn't" : "jobs this week aren't"} finished, so ${stillOpen === 1 ? "it's" : "they're"} not included`}>
            <Link className="font-semibold underline" href={`/office/subs${subQuery({ week, filter: "scheduled" })}`}>Review unfinished jobs</Link>
          </Callout>
        )}

        {workers.length === 0 && (
          <Empty title="No finished jobs this week">Earnings show up here as each job is finished.</Empty>
        )}

        <ul className="space-y-3">
          {workers.map((w) => (
            <li key={w.workerId} className="space-y-2 rounded-card border border-border/60 bg-surface p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{w.name}</h2>
                <p className="text-lg font-semibold">{formatCents(w.totalCents)}</p>
              </div>
              <ul className="divide-y divide-border/60">
                {w.jobs.map((j) => (
                  <li key={j.jobId} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <Link className="font-medium break-words hover:underline" href={`/office/subs/${j.jobId}`}>{formatDate(j.workDate)} · {j.address}</Link>
                      <span className="block text-xs text-muted">
                        {j.contractor} · {j.squares > 0 ? `${j.squares} sq at ${pitchLabel(j.pitch)}` : "gutters and extras"} · split {j.crewSize} ways
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">{formatCents(j.payCents)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {workers.length > 0 && <p className="text-xs text-muted">All shares total {formatCents(totalCents)}. Open a job to see its closeout.</p>}
      </WithRail>
    </>
  );
}
