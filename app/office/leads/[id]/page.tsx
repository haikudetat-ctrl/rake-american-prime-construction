import Link from "next/link";
import { notFound } from "next/navigation";
import { addLeadNote, moveLead, setLeadReferrer, updateLead, uploadRoofReport } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, utcToZonedInput } from "@/lib/dates";
import { NEED_LABEL, NEEDS, SOURCE_LABEL, STAGE_LABEL, STAGES, type Need, type Stage } from "@/lib/leads/schema";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Event = {
  id: string;
  kind: "created" | "stage" | "note" | "edited" | "call" | "text-in" | "text-out";
  from_stage: Stage | null;
  to_stage: Stage | null;
  body: string | null;
  actor_id: string | null;
  created_at: string;
};

const CALL_RESULT: Record<string, string> = { ringing: "Call", answered: "Call answered", missed: "Missed call", voicemail: "Voicemail" };

function describe(e: Event): string {
  if (e.kind === "call") return e.body ?? "Call";
  if (e.kind === "text-in") return "Text from them";
  if (e.kind === "text-out") return "Text sent";
  if (e.kind === "created") return "Lead came in";
  if (e.kind === "edited") return "Details edited";
  if (e.kind === "note") return "Note";
  return `${e.from_stage ? STAGE_LABEL[e.from_stage] : "—"} → ${e.to_stage ? STAGE_LABEL[e.to_stage] : "—"}`;
}

export default async function LeadPage({ params, searchParams }: PageProps<"/office/leads/[id]">) {
  await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) notFound();

  const [{ data: leadEvents }, { data: photos }, { data: people }, { data: calls }, { data: texts }, { data: measurements }, { data: proposals }, { data: referral }, { data: pastCustomers }] = await Promise.all([
    supabase.from("lead_events").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("lead_photos").select("id, path").eq("lead_id", id).order("created_at"),
    supabase.from("profiles").select("user_id, full_name"),
    supabase.from("phone_calls").select("id, status, recording_url, recording_seconds, created_at").eq("lead_id", id),
    supabase.from("messages").select("id, direction, body, sent_by, created_at").eq("lead_id", id),
    supabase.from("measurements").select("id, source, squares, pitch, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("proposals").select("id, number, status, options, needs_confirmation, updated_at").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("referrals").select("status, reward_cents, aftercare(customer_name, lead_id)").eq("lead_id", id).maybeSingle(),
    supabase.from("aftercare").select("job_id, customer_name, lead_id").neq("lead_id", id).order("customer_name").limit(500),
  ]);
  const referrer = referral ? (Array.isArray(referral.aftercare) ? referral.aftercare[0] : referral.aftercare) : null;
  // One timeline: pipeline events, calls and texts, newest first.
  const events: (Event & { recordingCallId?: string })[] = [
    ...((leadEvents ?? []) as Event[]),
    ...(calls ?? []).map((c) => ({
      id: c.id, kind: "call" as const, from_stage: null, to_stage: null, actor_id: null, created_at: c.created_at,
      body: c.status === "voicemail" ? `Voicemail (${c.recording_seconds ?? 0}s)` : (CALL_RESULT[c.status] ?? "Call"),
      recordingCallId: c.recording_url ? c.id : undefined,
    })),
    ...(texts ?? []).map((m) => ({
      id: m.id, kind: (m.direction === "in" ? "text-in" : "text-out") as Event["kind"], from_stage: null, to_stage: null,
      actor_id: m.sent_by, created_at: m.created_at, body: m.body,
    })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const names = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  // Private bucket: short-lived signed URLs, issued only after RLS let this user read the lead.
  const photoUrls = await Promise.all(
    (photos ?? []).map(async (p) => (await adminClient().storage.from("lead-photos").createSignedUrl(p.path, 600)).data?.signedUrl),
  );

  const stage = lead.stage as Stage;
  const mapsUrl = lead.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}` : null;

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/leads">← Roofing leads</Link></p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">{lead.name}</h1>
        <span className="pill">{STAGE_LABEL[stage]}</span>
      </div>
      <p className="text-sm text-muted">
        {NEED_LABEL[lead.need as Need]} · {SOURCE_LABEL[lead.source] ?? lead.source} · came in {formatDateTime(lead.created_at)}
        {lead.appointment_at && <> · appointment {formatDateTime(lead.appointment_at)}</>}
      </p>

      <section className="card grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted">Phone</p>
          {lead.phone ? (
            <p className="flex gap-3"><a className="underline" href={`tel:${lead.phone}`}>{formatPhone(lead.phone)}</a>
              <Link className="underline" href={`/office/inbox/${encodeURIComponent(lead.phone)}`}>Text</Link></p>
          ) : <p>—</p>}
        </div>
        <div>
          <p className="text-xs text-muted">Email</p>
          <p>{lead.email ? <a className="underline" href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Address</p>
          <p>{mapsUrl ? <a className="underline" href={mapsUrl} target="_blank" rel="noreferrer">{lead.address}</a> : "—"}</p>
        </div>
        {lead.notes && <p className="sm:col-span-3 whitespace-pre-line text-sm">{lead.notes}</p>}
        {lead.contact_consent_at
          ? <p className="sm:col-span-3 text-xs text-muted">Agreed to calls and texts on {formatDateTime(lead.contact_consent_at)}.</p>
          : lead.source === "link" && <p className="sm:col-span-3 text-xs text-warn">Did not tick the text consent box: call rather than text.</p>}
      </section>

      <section className="card flex flex-wrap items-center gap-3 text-sm">
        {referrer ? (
          <p>Referred by <Link className="underline" href={`/office/leads/${referrer.lead_id}`}>{referrer.customer_name}</Link>
            {" "}· reward {formatCents(referral!.reward_cents)} ({referral!.status === "earned" ? "owed" : referral!.status})</p>
        ) : (pastCustomers ?? []).length > 0 ? (
          <form action={setLeadReferrer} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="leadId" value={lead.id} />
            <span>Referred by a past customer?</span>
            <select name="referrerJobId" required className="input w-56" defaultValue="">
              <option value="" disabled>Choose…</option>
              {pastCustomers!.map((c) => <option key={c.job_id} value={c.job_id}>{c.customer_name}</option>)}
            </select>
            <button className="btn-secondary">Save</button>
          </form>
        ) : <p className="text-muted">Referrals show here once past customers have their referral links.</p>}
      </section>

      {photoUrls.some(Boolean) && (
        <section className="card">
          <h2 className="mb-2 font-semibold">Photos from the homeowner</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photoUrls.map((url, i) => url && (
              <a key={i} href={url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed private URLs */}
                <img src={url} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-md object-cover" />
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Measurements and estimates</h2>
        <div className="flex flex-wrap items-end gap-3">
          <form action={uploadRoofReport} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="label"><span>Roofr report (PDF)</span>
              <input name="report" type="file" accept="application/pdf" required className="input" />
            </label>
            <button className="btn-secondary">Read report</button>
          </form>
          <Link className="btn-secondary" href={`/office/leads/${lead.id}/measure`}>Enter by hand</Link>
          {(measurements ?? []).length > 0 && (
            <Link className="btn" href={`/office/leads/${lead.id}/estimate?m=${measurements![0].id}`}>New estimate</Link>
          )}
        </div>
        {(measurements ?? []).length > 0 && (
          <ul className="text-sm">
            {measurements!.map((m) => (
              <li key={m.id}>
                {Number(m.squares)} squares at {Number(m.pitch)}/12 · {m.source === "roofr" ? "Roofr report" : "entered"} {formatDateTime(m.created_at)}{" "}
                <Link className="underline" href={`/office/leads/${lead.id}/measure?m=${m.id}`}>edit</Link>
              </li>
            ))}
          </ul>
        )}
        {(proposals ?? []).length > 0 && (
          <table className="table text-sm">
            <thead><tr><th>Estimate</th><th>Options</th><th>Status</th></tr></thead>
            <tbody>
              {proposals!.map((p) => (
                <tr key={p.id}>
                  <td><Link className="underline" href={`/office/proposals/${p.id}`}>#{p.number}</Link>
                    <div className="text-xs text-muted">{formatDateTime(p.updated_at)}</div></td>
                  <td>{(p.options as { name: string; priceCents: number; overrideCents?: number }[])
                    .map((o) => `${o.name} ${formatCents(o.overrideCents ?? o.priceCents)}`).join(" · ")}</td>
                  <td>{p.status}{p.needs_confirmation && <span className="text-xs text-warn"> · placeholder prices</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Move this lead</h2>
        <form action={moveLead} className="grid gap-2 sm:grid-cols-4 sm:items-end">
          <input type="hidden" name="leadId" value={lead.id} />
          <label className="label"><span>Stage</span>
            <select name="stage" className="input" defaultValue={stage}>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="label"><span>Appointment (if booking)</span>
            <input name="appointmentAt" type="datetime-local" className="input"
              defaultValue={lead.appointment_at ? utcToZonedInput(lead.appointment_at) : ""} />
          </label>
          <label className="label"><span>Why lost (if lost)</span>
            <input name="lostReason" className="input" defaultValue={lead.lost_reason ?? ""} />
          </label>
          <label className="label"><span>Note (optional)</span><input name="note" className="input" /></label>
          <button className="btn sm:col-span-4 sm:justify-self-start">Save</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Timeline</h2>
        <form action={addLeadNote} className="flex gap-2">
          <input type="hidden" name="leadId" value={lead.id} />
          <input name="body" required className="input flex-1" placeholder="Add a note…" />
          <button className="btn-secondary">Add</button>
        </form>
        <ul className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3">
              <p><span className="font-medium">{describe(e)}</span>{e.body && e.kind !== "call" && <> — {e.body}</>}</p>
              {e.recordingCallId && <audio controls preload="none" src={`/api/twilio/recording/${e.recordingCallId}`} className="mt-1 h-8" />}
              <p className="text-xs text-muted">
                {formatDateTime(e.created_at)}{e.actor_id && names.get(e.actor_id) ? ` · ${names.get(e.actor_id)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <details className="card">
        <summary className="cursor-pointer font-semibold">Edit details</summary>
        <form action={updateLead} className="mt-3 grid gap-2 sm:grid-cols-3 sm:items-end">
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="source" value="office" />
          <label className="label"><span>Name</span><input name="name" required defaultValue={lead.name} className="input" /></label>
          <label className="label"><span>Phone</span><input name="phone" type="tel" defaultValue={lead.phone ? formatPhone(lead.phone) : ""} className="input" /></label>
          <label className="label"><span>Email</span><input name="email" type="email" defaultValue={lead.email ?? ""} className="input" /></label>
          <label className="label sm:col-span-2"><span>Address</span><input name="address" defaultValue={lead.address ?? ""} className="input" /></label>
          <label className="label"><span>Need</span>
            <select name="need" className="input" defaultValue={lead.need}>
              {NEEDS.map((n) => <option key={n} value={n}>{NEED_LABEL[n]}</option>)}
            </select>
          </label>
          <label className="label sm:col-span-3"><span>Notes</span><textarea name="notes" rows={3} defaultValue={lead.notes ?? ""} className="input" /></label>
          <button className="btn sm:col-span-3 sm:justify-self-start">Save details</button>
        </form>
      </details>
    </>
  );
}
