import Link from "next/link";
import { sendText } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { loadThreads } from "@/lib/phone/inbox";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CALL_STATUS: Record<string, string> = {
  ringing: "Ringing",
  answered: "Answered",
  missed: "Missed",
  voicemail: "Voicemail",
};

export default async function InboxPage({ searchParams }: PageProps<"/office/inbox">) {
  await requireStaff();
  const params = await searchParams;
  const calls = params.tab === "calls";
  const supabase = await createSupabaseServerClient();

  return (
    <>
      <Notice searchParams={params} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">Inbox</h1>
        <div className="flex gap-3 text-sm">
          <Link className={calls ? "underline" : "font-semibold"} href="/office/inbox">Texts</Link>
          <Link className={calls ? "font-semibold" : "underline"} href="/office/inbox?tab=calls">Calls</Link>
        </div>
      </div>
      {calls ? <CallLog supabase={supabase} /> : <Threads supabase={supabase} />}
    </>
  );
}

async function Threads({ supabase }: { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }) {
  const threads = await loadThreads(supabase);
  return (
    <>
      <section className="card divide-y divide-border p-0">
        {threads.map((t) => (
          <Link key={t.phone} href={`/office/inbox/${encodeURIComponent(t.phone)}`}
            className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-background">
            <div className="min-w-0">
              <p className={t.unread ? "font-semibold" : ""}>{t.name ?? formatPhone(t.phone)}</p>
              <p className="truncate text-sm text-muted">{t.lastDirection === "out" ? "You: " : ""}{t.lastBody || "(photo)"}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-muted">
              <p>{formatDateTime(t.lastAt)}</p>
              {t.unread > 0 && <span className="rounded-full bg-accent px-1.5 text-accent-foreground">{t.unread}</span>}
            </div>
          </Link>
        ))}
        {threads.length === 0 && <p className="px-4 py-3 text-sm text-muted">No texts yet. Texts to the business number land here.</p>}
      </section>
      <section className="card">
        <h2 className="mb-2 font-semibold">New text</h2>
        <form action={sendText} className="grid gap-2 sm:grid-cols-4 sm:items-end">
          <label className="label"><span>To</span><input name="phone" type="tel" required className="input" /></label>
          <label className="label sm:col-span-2"><span>Message</span><input name="body" required maxLength={1600} className="input" /></label>
          <button className="btn sm:justify-self-start">Send</button>
        </form>
        <p className="mt-2 text-xs text-muted">Sent from the business number. Only text people who agreed to texts.</p>
      </section>
    </>
  );
}

async function CallLog({ supabase }: { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }) {
  const { data } = await supabase
    .from("phone_calls")
    .select("id, from_number, status, after_hours, duration_seconds, recording_url, recording_seconds, created_at, lead_id, customer_id, leads(name), customers(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <section className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>When</th><th>From</th><th>Result</th><th>Voicemail</th></tr></thead>
        <tbody>
          {(data ?? []).map((c) => {
            const lead = Array.isArray(c.leads) ? c.leads[0] : c.leads;
            const customer = Array.isArray(c.customers) ? c.customers[0] : c.customers;
            const who = lead?.name ?? customer?.name ?? formatPhone(c.from_number);
            return (
              <tr key={c.id}>
                <td>{formatDateTime(c.created_at)}</td>
                <td>
                  {c.lead_id ? <Link className="underline" href={`/office/leads/${c.lead_id}`}>{who}</Link>
                    : c.customer_id ? <Link className="underline" href={`/office/customers/${c.customer_id}`}>{who}</Link> : who}
                  <div className="text-xs text-muted"><a className="underline" href={`tel:${c.from_number}`}>{formatPhone(c.from_number)}</a></div>
                </td>
                <td>
                  {CALL_STATUS[c.status] ?? c.status}
                  {c.after_hours && <span className="text-xs text-muted"> · after hours</span>}
                  {c.status === "answered" && c.duration_seconds ? <span className="text-xs text-muted"> · {Math.round(c.duration_seconds / 60)} min</span> : null}
                </td>
                <td>{c.recording_url ? <audio controls preload="none" src={`/api/twilio/recording/${c.id}`} className="h-8" /> : "—"}</td>
              </tr>
            );
          })}
          {(data ?? []).length === 0 && <tr><td colSpan={4} className="text-muted">No calls yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
