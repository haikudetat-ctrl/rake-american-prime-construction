import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { companyToday } from "@/lib/dates";
import { workspaces } from "@/lib/office/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Count = { count: number | null; error: unknown };

/** "3 new leads", or null when the count could not load (never shown as zero). */
function counted(result: Count, one: string, many: string): string | null {
  if (result.error || result.count === null) return null;
  return `${result.count} ${result.count === 1 ? one : many}`;
}

function detail(parts: (string | null)[]): string {
  return parts.some((p) => p === null) ? "Counts unavailable right now. Open to see the work." : parts.join(" · ");
}

/** Jobs (phone tab): the three lines of business, each with what is waiting in it. */
export default async function WorkspacesPage() {
  await requireStaff();
  const today = companyToday();
  const db = await createSupabaseServerClient();
  const head = { count: "exact", head: true } as const;
  const [leads, roofing, subs, overdue, requests, stops] = await Promise.all([
    db.from("leads").select("id", head).eq("stage", "new"),
    db.from("roofing_jobs").select("id", head).in("status", ["scheduled", "in_progress"]),
    db.from("sub_jobs").select("id", head).eq("status", "scheduled"),
    db.from("sub_invoices").select("id", head).eq("status", "open").lt("due_on", today),
    db.from("rental_requests").select("id", head).eq("status", "pending"),
    db.from("stops").select("id", head).eq("scheduled_date", today).eq("status", "scheduled"),
  ]);
  const details: Record<(typeof workspaces)[number]["id"], string> = {
    roofing: detail([counted(leads, "new lead", "new leads"), counted(roofing, "open job", "open jobs")]),
    subs: detail([counted(subs, "scheduled job", "scheduled jobs"), counted(overdue, "overdue invoice", "overdue invoices")]),
    dumpsters: detail([counted(requests, "request to review", "requests to review"), counted(stops, "stop today", "stops today")]),
  };

  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow">Jobs</p>
        <h1 className="page-title">Workspaces</h1>
        <p className="text-muted">Open a line of work to see its leads, jobs and billing.</p>
      </header>
      <WorkList label="Workspaces">
        {workspaces.map((w) => <WorkRow key={w.id} href={w.href} title={w.label} detail={details[w.id]} />)}
      </WorkList>
    </>
  );
}
