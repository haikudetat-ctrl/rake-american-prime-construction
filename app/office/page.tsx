import Link from "next/link";
import { redirect } from "next/navigation";
import { Callout } from "@/app/_ui/callout";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate } from "@/lib/dates";
import { buildQueues, PROPOSAL_FOLLOW_UP_DAYS, QUEUE_LIMIT, summarize } from "@/lib/office/today";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Notice } from "./_notice";

const JOB_STATUS: Record<string, string> = { scheduled: "Scheduled", in_progress: "In progress", done: "Work complete" };

/** Today (Figma V2 05 to 08): what needs a next step, oldest first, with today's schedule beside it. */
export default async function TodayPage({ searchParams }: PageProps<"/office">) {
  await requireStaff();
  const query = await searchParams;
  // Preserve bookmarked dispatch dates, including their action feedback.
  if (typeof query.date === "string") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === "string") params.set(key, value);
    redirect(`/office/dumpsters?${params}`);
  }
  const today = companyToday();
  const followUpBefore = `${addDays(today, -PROPOSAL_FOLLOW_UP_DAYS)}T12:00:00Z`;
  const db = await createSupabaseServerClient();
  const n = QUEUE_LIMIT;
  const [leads, requests, closeout, ready, overdue, proposals, roofing, subs, stops] = await Promise.all([
    db.from("leads").select("id, name, address, area, need, created_at", { count: "exact" }).eq("stage", "new").order("created_at").limit(n),
    db.from("rental_requests").select("id, contact_name, company_name, address, requested_date", { count: "exact" }).eq("status", "pending").order("requested_date").limit(n),
    db.from("sub_jobs").select("id, address, work_date, sub_contractors(name)", { count: "exact" }).eq("status", "scheduled").lte("work_date", today).order("work_date").limit(n),
    db.from("invoices").select("id, total_cents, customer_id, customers(name)").eq("status", "final").order("created_at").limit(500),
    db.from("sub_invoices").select("id, job_id, number, total_cents, due_on, sub_contractors(name), sub_payments(amount_cents, voided_at)", { count: "exact" }).eq("status", "open").lt("due_on", today).order("due_on").limit(n),
    db.from("proposals").select("id, number, sent_at, viewed_at, leads(name, address)", { count: "exact" }).eq("status", "sent").lt("sent_at", followUpBefore).order("sent_at").limit(n),
    db.from("roofing_jobs").select("id, address, status").eq("install_date", today).order("created_at").limit(20),
    db.from("sub_jobs").select("id, address, status").eq("work_date", today).neq("status", "void").order("created_at").limit(20),
    db.from("stops").select("id", { count: "exact", head: true }).eq("scheduled_date", today).eq("status", "scheduled"),
  ]);

  const queues = buildQueues(today, { leads, requests, closeout, ready, overdue, proposals });
  const { waiting, unavailable } = summarize(queues);
  const shown = queues.filter((q) => q.count);
  const items = (k: number) => (k === 1 ? "1 item needs" : `${k} items need`);

  return (
    <>
      <Notice searchParams={query} />
      <header className="space-y-1">
        <p className="eyebrow">Today · {formatDate(today)}</p>
        <h1 className="page-title">Keep work moving</h1>
        <p className="text-muted">
          {unavailable.length
            ? waiting ? `At least ${items(waiting)} a next step.` : "Some work could not load, so the total is unknown."
            : waiting
              ? `${items(waiting)} a next step, oldest first.`
              : "Nothing needs a next step right now."}
        </p>
      </header>

      <WithRail rail={<TodaysWork today={today} roofing={roofing} subs={subs} stops={stops} />}>
        <div className="space-y-7">
          {unavailable.length > 0 && (
            <Callout tone="warning" title="Some work is unavailable">
              {unavailable.map((q) => q.label).join(", ")} could not load, so {unavailable.length === 1 ? "its count is" : "their counts are"} unknown, not zero.
              Reload to try again. If it keeps happening, ask an owner to check the connection.
            </Callout>
          )}
          {shown.length === 0 && unavailable.length === 0 && (
            <Empty title="Nothing needs review">New leads, requests, closeouts and invoices will show up here.</Empty>
          )}
          {shown.map((q) => (
            <section key={q.id} aria-labelledby={`queue-${q.id}`} className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`queue-${q.id}`} className="text-base">
                  {q.label} <span className="font-normal text-muted">{q.count}</span>
                </h2>
                {q.count! > q.items.length && (
                  <Link href={q.href} className="text-sm font-semibold text-accent hover:underline">See all {q.count}</Link>
                )}
              </div>
              <WorkList label={q.label}>
                {q.items.map((i) => <WorkRow key={i.key} href={i.href} title={i.title} detail={i.detail} action={i.action} />)}
              </WorkList>
            </section>
          ))}
        </div>
      </WithRail>
    </>
  );
}

type Jobs = { data: { id: string; address: string | null; status: string }[] | null; error: unknown };

function TodaysWork({ today, roofing, subs, stops }: { today: string; roofing: Jobs; subs: Jobs; stops: { count: number | null; error: unknown } }) {
  const lists = [
    { label: "Roofing installs", base: "/office/jobs", result: roofing, all: "All roofing jobs" },
    { label: "Subcontract work", base: "/office/subs", result: subs, all: "All subcontract jobs" },
  ];
  return (
    <RailCard title={`Today's schedule · ${formatDate(today)}`}>
      {lists.map(({ label, base, result, all }) => (
        <div key={base} className="border-b border-border/60 pb-3">
          <h3 className="text-xs font-semibold text-muted">{label}</h3>
          {result.error || !result.data ? (
            <p role="status" className="py-1 text-danger">Unavailable. Reload to try again.</p>
          ) : result.data.length ? (
            <ul>
              {result.data.map((j) => (
                <li key={j.id}>
                  <Link className="flex min-h-11 items-center justify-between gap-3 py-1.5 hover:underline" href={`${base}/${j.id}`}>
                    <span className="font-medium break-words">{j.address ?? "No address"}</span>
                    <span className="shrink-0 text-xs text-muted">{JOB_STATUS[j.status] ?? j.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1 text-muted">Nothing scheduled today.</p>
          )}
          <Link href={base} className="text-xs font-semibold text-accent hover:underline">{all}</Link>
        </div>
      ))}
      <div>
        <h3 className="text-xs font-semibold text-muted">Dumpster stops</h3>
        <p className="py-1">
          {stops.error || stops.count === null ? "Dispatch count unavailable." : stops.count === 0 ? "No stops still scheduled today." : stops.count === 1 ? "1 stop still scheduled today." : `${stops.count} stops still scheduled today.`}
        </p>
        <Link href="/office/dumpsters" className="text-xs font-semibold text-accent hover:underline">Open dispatch</Link>
      </div>
    </RailCard>
  );
}
