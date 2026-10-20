import Link from "next/link";
import { scheduleRoofingJob, setRoofingJobStatus } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadTeam } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS = { scheduled: "Scheduled", in_progress: "In progress", done: "Done" } as const;

/** Won roofing jobs: when, who, and where they stand. */
export default async function JobsPage({ searchParams }: PageProps<"/office/jobs">) {
  await requireStaff();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: jobs }, team] = await Promise.all([
    supabase.from("roofing_jobs").select("*").order("status").order("install_date", { nullsFirst: true }).limit(200),
    loadTeam(supabase),
  ]);
  const crew = team.filter((m) => m.isActive);
  const name = new Map(crew.map((m) => [m.userId, m.name]));

  return (
    <>
      <Notice searchParams={query} />
      <h1 className="text-xl font-semibold">Roofing jobs</h1>
      {(jobs ?? []).length === 0 && <p className="card text-sm text-muted">Signed proposals become jobs here.</p>}
      {(jobs ?? []).map((j) => (
        <section key={j.id} className="card space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <Link className="font-semibold underline" href={`/office/leads/${j.lead_id}`}>{j.customer_name}</Link>
              <span className="text-sm text-muted"> · {j.address}</span>
            </div>
            <span className="pill">{STATUS[j.status as keyof typeof STATUS]}</span>
          </div>
          <p className="text-sm">
            {j.system_name} · {formatCents(j.total_cents)} ·{" "}
            <Link className="underline" href={`/office/proposals/${j.proposal_id}`}>agreement</Link>
            {j.install_date && <> · install {formatDate(j.install_date)}</>}
            {j.crew_ids.length > 0 && <> · crew {j.crew_ids.map((id: string) => name.get(id) ?? "?").join(", ")}</>}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer">Schedule</summary>
            <form action={scheduleRoofingJob} className="mt-2 grid gap-2 sm:grid-cols-3 sm:items-end">
              <input type="hidden" name="jobId" value={j.id} />
              <label className="label"><span>Install date</span><input name="installDate" type="date" defaultValue={j.install_date ?? ""} className="input" /></label>
              <fieldset className="label sm:col-span-2">
                <span>Crew</span>
                <div className="flex flex-wrap gap-3">
                  {crew.map((m) => (
                    <label key={m.userId} className="flex items-center gap-1">
                      <input type="checkbox" name="crewId" value={m.userId} defaultChecked={j.crew_ids.includes(m.userId)} /> {m.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="label sm:col-span-3"><span>Notes for the crew</span><input name="notes" defaultValue={j.notes ?? ""} className="input" /></label>
              <button className="btn sm:justify-self-start">Save</button>
            </form>
          </details>
          {j.status !== "done" && (
            <form action={setRoofingJobStatus} className="flex gap-2 text-sm">
              <input type="hidden" name="jobId" value={j.id} />
              <input type="hidden" name="returnTo" value="/office/jobs" />
              {j.status === "scheduled" && <button name="status" value="in_progress" className="btn-secondary">Mark started</button>}
              <button name="status" value="done" className="btn-secondary">Mark done</button>
            </form>
          )}
        </section>
      ))}
    </>
  );
}
