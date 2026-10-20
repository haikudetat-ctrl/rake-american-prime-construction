import Link from "next/link";
import { createLead, moveLead } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { daysInStage, NEED_LABEL, NEEDS, needsAttention, SOURCE_LABEL, STAGE_LABEL, type Need, type Stage } from "@/lib/leads/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OPEN: Stage[] = ["new", "contacted", "appointment", "proposal_sent"];

type LeadRow = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  need: Need;
  source: string;
  stage: Stage;
  stage_changed_at: string;
  appointment_at: string | null;
  lost_reason: string | null;
};

export default async function LeadsPage({ searchParams }: PageProps<"/office/leads">) {
  await requireStaff();
  const params = await searchParams;
  const closed = params.show === "closed";
  const supabase = await createSupabaseServerClient();
  const query = supabase
    .from("leads")
    .select("id, name, area, address, need, source, stage, stage_changed_at, appointment_at, lost_reason")
    .order("stage_changed_at", { ascending: closed ? false : true });
  const { data } = closed ? await query.in("stage", ["won", "lost"]).limit(100) : await query.in("stage", OPEN);
  const leads = (data ?? []) as LeadRow[];

  return (
    <>
      <Notice searchParams={params} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Roofing leads</h1>
        <div className="flex gap-3 text-sm">
          <Link className={closed ? "underline" : "font-semibold"} href="/office/leads">Open</Link>
          <Link className={closed ? "font-semibold" : "underline"} href="/office/leads?show=closed">Won / lost</Link>
        </div>
      </div>

      {closed ? (
        <section className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Lead</th><th>Result</th><th>When</th><th>Source</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td><Link className="underline" href={`/office/leads/${l.id}`}>{l.name}</Link>
                    <div className="text-xs text-muted">{l.area ?? l.address}</div></td>
                  <td>{l.stage === "won" ? <span className="text-ok">Won</span> : <>Lost<div className="text-xs text-muted">{l.lost_reason}</div></>}</td>
                  <td>{formatDateTime(l.stage_changed_at)}</td>
                  <td>{SOURCE_LABEL[l.source] ?? l.source}</td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={4} className="text-muted">Nothing closed yet.</td></tr>}
            </tbody>
          </table>
        </section>
      ) : (
        <div className="grid gap-3 md:grid-cols-4">
          {OPEN.map((stage) => {
            const column = leads.filter((l) => l.stage === stage);
            return (
              <section key={stage} className="space-y-2">
                <h2 className="text-sm font-semibold text-muted">
                  {STAGE_LABEL[stage]} <span className="font-normal">({column.length})</span>
                </h2>
                {column.map((l) => (
                  <article key={l.id} className="card space-y-1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link className="font-medium underline" href={`/office/leads/${l.id}`}>{l.name}</Link>
                      {needsAttention(l.stage, l.stage_changed_at) && (
                        <span className="pill border-warn text-warn">follow up</span>
                      )}
                    </div>
                    <p className="text-sm">{NEED_LABEL[l.need]}{l.area ? ` · ${l.area}` : ""}</p>
                    <p className="text-xs text-muted">
                      {stage === "appointment" && l.appointment_at
                        ? formatDateTime(l.appointment_at)
                        : `${daysInStage(l.stage_changed_at)} d in stage · ${SOURCE_LABEL[l.source] ?? l.source}`}
                    </p>
                    {stage === "new" && (
                      <form action={moveLead}>
                        <input type="hidden" name="leadId" value={l.id} />
                        <input type="hidden" name="stage" value="contacted" />
                        <input type="hidden" name="returnTo" value="/office/leads" />
                        <button className="text-xs underline">Mark contacted</button>
                      </form>
                    )}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold">Add a lead</h2>
        <form action={createLead} className="grid gap-2 sm:grid-cols-3 sm:items-end">
          <label className="label"><span>Name</span><input name="name" required className="input" /></label>
          <label className="label"><span>Phone</span><input name="phone" type="tel" className="input" /></label>
          <label className="label"><span>Email</span><input name="email" type="email" className="input" /></label>
          <label className="label sm:col-span-2"><span>Address</span><input name="address" className="input" /></label>
          <label className="label"><span>Came in by</span>
            <select name="source" className="input" defaultValue="phone">
              <option value="phone">Phone call</option>
              <option value="text">Text</option>
              <option value="referral">Referral</option>
              <option value="office">Other</option>
            </select>
          </label>
          <label className="label"><span>Need</span>
            <select name="need" className="input" defaultValue="replacement">
              {NEEDS.map((n) => <option key={n} value={n}>{NEED_LABEL[n]}</option>)}
            </select>
          </label>
          <label className="label sm:col-span-2"><span>Notes</span><input name="notes" className="input" /></label>
          <button className="btn sm:col-span-3 sm:justify-self-start">Add lead</button>
        </form>
      </section>
    </>
  );
}
