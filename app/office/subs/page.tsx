import { AddJobs } from "./_add-jobs";
import { Unavailable } from "../_unavailable";
import { subQuery } from "@/lib/subcontract/navigation";
import Link from "next/link";
import { STATUS_LABEL } from "@/app/office/subs/_parts";
import { Callout } from "@/app/_ui/callout";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate, weekStart } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { one } from "@/lib/office/team";
import { crewRateFrom, type ContractorOption } from "@/lib/subcontract/add-jobs";
import { readTiers } from "@/lib/subcontract/tiers";
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

  const [{ data: contractors, error: contractorsError }, { data: workers, error: workersError }, { data: jobs, error: jobsError }, { data: open, error: invoicesError }, { data: settings, error: settingsError }, { data: priceItems, error: itemsError }] = await Promise.all([
    supabase.from("sub_contractors").select("id, name, billing, cents_per_sq, pitch_tiers, min_job_cents").eq("is_active", true).order("name"),
    supabase.from("sub_workers").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("sub_jobs")
      .select("id, work_date, address, status, squares, pitch, bill_total_cents, pay_total_cents, sub_contractors(name), sub_job_crew(sub_workers(name)), sub_invoices(number, status)")
      .gte("work_date", week)
      .lt("work_date", end)
      .order("work_date")
      .order("created_at"),
    supabase.from("sub_invoices").select("total_cents, sub_payments(amount_cents, voided_at)").eq("status", "open"),
    supabase.from("sub_settings").select("crew_cents_per_sq, crew_pitch_tiers").maybeSingle(),
    supabase.from("sub_price_items").select("id, contractor_id, description, unit, bill_unit_cents, pay_unit_cents").eq("is_active", true).order("description"),
  ]);

  if (contractorsError || workersError || jobsError || invoicesError || settingsError || itemsError) return <Unavailable />;
  // What the add-jobs form needs to show each job's bill before it goes in.
  const options: ContractorOption[] = (contractors ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    weekly: c.billing !== "per_job",
    rate: { base: c.cents_per_sq, tiers: readTiers(c.pitch_tiers), minimumCents: c.min_job_cents },
    items: (priceItems ?? [])
      .filter((i) => i.contractor_id === c.id)
      .map((i) => ({ id: i.id, description: i.description, unit: i.unit, billCents: i.bill_unit_cents, payCents: i.pay_unit_cents })),
  }));
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

  const weekLabel = `${formatDate(week)} to ${formatDate(addDays(week, 6))}`;
  const scheduled = rows.filter((j) => j.status === "scheduled").length;

  return (
    <>
      <Notice searchParams={query} />
      <header className="space-y-1">
        <p className="eyebrow">Subcontracting</p>
        <h1 className="page-title">Weekly subcontract work</h1>
        <p className="text-muted">
          {weekLabel} · {rows.length === 0 ? "no jobs yet" : `${scheduled} scheduled · ${closed.length} finished`}
        </p>
      </header>

      <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
        <Link className="btn-secondary" href={`/office/subs${subQuery({ week: addDays(week, -7), filter })}`}>‹ Previous week</Link>
        {week !== weekStart(today) && <Link className="btn-secondary" href="/office/subs">This week</Link>}
        <Link className="btn-secondary" href={`/office/subs${subQuery({ week: addDays(week, 7), filter })}`}>Next week ›</Link>
        {ready && <a className="btn" href="#add-jobs">Add jobs</a>}
      </nav>

      <WithRail
        rail={
          <>
            <RailCard title="This week so far">
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
                <dt className="text-muted">Billed to contractors</dt>
                <dd className="text-right font-semibold">{formatCents(billed)}</dd>
                <dt className="text-muted">Crew earnings</dt>
                <dd className="text-right font-semibold">{formatCents(crew)}</dd>
                <dt className="text-muted">Billed less crew</dt>
                <dd className="text-right font-semibold">{formatCents(billed - crew)}{billed ? ` (${Math.round(((billed - crew) / billed) * 100)}%)` : ""}</dd>
              </dl>
              <p className="text-xs text-muted">{closed.length} finished {closed.length === 1 ? "job" : "jobs"} · {Math.round(squares * 100) / 100} sq. Scheduled jobs count once they are finished.</p>
              <Link className="text-sm font-semibold text-accent hover:underline" href={`/office/subs/payroll${returnQuery}`}>Weekly crew earnings</Link>
            </RailCard>
            <RailCard title="Contractors owe">
              <p className="text-2xl font-bold">{formatCents(owed)}</p>
              <p className="text-xs text-muted">Across every open invoice, not just this week.</p>
              <Link className="text-sm font-semibold text-accent hover:underline" href="/office/subs/invoices">Contractor invoices</Link>
            </RailCard>
            <p className="px-3 text-xs text-muted">
              <Link className="underline" href="/office/subs/setup">Setup: contractors, crew, rates</Link>
            </p>
          </>
        }
      >
        {stillOpen > 0 && (
          <Callout tone="warning" title={`${stillOpen} ${stillOpen === 1 ? "job is" : "jobs are"} still open from today or earlier`}>
            Finish {stillOpen === 1 ? "it" : "them"} so the contractor gets billed and the crew has earnings recorded.
          </Callout>
        )}

        <nav aria-label="Job status filter" className="flex flex-wrap gap-2">
          {[{ value: "all", label: "All work" }, { value: "scheduled", label: "Needs finishing" }, { value: "done", label: "Work complete" }].map((f) => (
            <Link key={f.value} className={filter === f.value ? "btn" : "btn-secondary"} aria-current={filter === f.value ? "page" : undefined} href={`/office/subs${subQuery({ week, filter: f.value })}`}>{f.label}</Link>
          ))}
        </nav>
        {visible.length === 0 && (
          <Empty title={rows.length === 0 ? "No jobs this week" : "No jobs match this filter"}>
            {rows.length === 0 ? "Add the week's jobs below, one at a time or as a pasted list." : "Pick another filter to see the rest of the week."}
          </Empty>
        )}

        {days.map((day) => (
          <section key={day} aria-labelledby={`day-${day}`} className="space-y-2.5">
            <h2 id={`day-${day}`} className="text-base">
              {formatDate(day)}{day === today && <span className="ml-2 align-middle"><StatusPill>Today</StatusPill></span>}
            </h2>
            <WorkList label={formatDate(day)}>
              {visible.filter((j) => j.work_date === day).map((job) => {
                const invoice = (job.sub_invoices ?? []).find((i) => i.status !== "void");
                const names = (job.sub_job_crew ?? []).map((c) => one(c.sub_workers)?.name ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b));
                const detail =
                  job.status === "done"
                    ? `${one(job.sub_contractors)?.name} · ${Number(job.squares) > 0 ? `${Number(job.squares)} sq at ${job.pitch}/12` : "gutters and extras"} · billed ${formatCents(job.bill_total_cents)} · crew ${formatCents(job.pay_total_cents)}${invoice ? ` · invoice #${invoice.number} ${invoice.status === "paid" ? "paid" : "outstanding"}` : ""}`
                    : `${one(job.sub_contractors)?.name} · ${names.length ? names.join(", ") : "no crew yet"}`;
                return (
                  <WorkRow
                    key={job.id}
                    href={`/office/subs/${job.id}${returnQuery}`}
                    title={job.address}
                    detail={detail}
                    action={job.status === "scheduled" ? (names.length ? "Review and finish" : "Assign crew") : undefined}
                    aside={<StatusPill tone={job.status === "scheduled" ? "warning" : job.status === "done" ? "success" : "neutral"}>{STATUS_LABEL[job.status]}</StatusPill>}
                  />
                );
              })}
            </WorkList>
          </section>
        ))}

        <section id="add-jobs" className="card space-y-3">
          <div>
            <h2 className="font-semibold">Add jobs</h2>
            <p className="text-sm text-muted">
              One job or a whole list. Missed one? Put it in with its day, squares and pitch and it closes and bills as it goes in.
            </p>
          </div>
          {!ready ? (
            <p className="text-sm text-muted">
              Add the contractors you work for and your crew in <Link className="underline" href="/office/subs/setup">Setup</Link> first.
            </p>
          ) : (
            <AddJobs contractors={options} workers={workers ?? []} crewRate={crewRateFrom(settings)} today={today}
              defaultDate={week === weekStart(today) ? today : week} />
          )}
        </section>
      </WithRail>
    </>
  );
}
