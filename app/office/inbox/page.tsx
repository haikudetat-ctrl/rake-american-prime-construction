import Link from "next/link";
import { sendText } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty, Unavailable } from "@/app/_ui/states";
import { StatusPill, type Tone } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { loadThreads } from "@/lib/phone/inbox";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CALL_STATUS: Record<string, { label: string; tone: Tone }> = {
  ringing: { label: "Ringing", tone: "neutral" },
  answered: { label: "Answered", tone: "success" },
  missed: { label: "Missed", tone: "danger" },
  voicemail: { label: "Voicemail", tone: "warning" },
};
const CALL_OUT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ringing: { label: "Calling out", tone: "neutral" },
  answered: { label: "Called out", tone: "success" },
  missed: { label: "Didn't connect", tone: "warning" },
};

/** Inbox (Figma V2 58): texts to the business number by person, and the call log beside them. */
export default async function InboxPage({ searchParams }: PageProps<"/office/inbox">) {
  await requireStaff();
  const params = await searchParams;
  const calls = params.tab === "calls";
  const supabase = await createSupabaseServerClient();

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Office · Inbox</p>
        <h1 className="page-title">Inbox</h1>
        <p className="text-muted">Texts and calls to the business number.</p>
      </header>
      <nav aria-label="Inbox view" className="flex flex-wrap gap-2">
        <Link className={calls ? "btn-secondary" : "btn"} aria-current={calls ? undefined : "page"} href="/office/inbox">Texts</Link>
        <Link className={calls ? "btn" : "btn-secondary"} aria-current={calls ? "page" : undefined} href="/office/inbox?tab=calls">Calls and voicemail</Link>
      </nav>
      <WithRail rail={<NewText />}>
        {calls ? <CallLog supabase={supabase} /> : <Threads supabase={supabase} />}
      </WithRail>
    </>
  );
}

function NewText() {
  return (
    <RailCard title="New text">
      <form action={sendText} className="space-y-2">
        <label className="label"><span>To</span><input name="phone" type="tel" required className="input" /></label>
        <label className="label"><span>Message</span><textarea name="body" required rows={3} maxLength={1600} className="input" /></label>
        <button className="btn w-full">Send</button>
      </form>
      <p className="text-xs text-muted">Sent from the business number. Only text people who agreed to texts. Sending means queued, not delivered.</p>
    </RailCard>
  );
}

async function Threads({ supabase }: { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }) {
  const threads = await loadThreads(supabase);
  if (!threads) return <Unavailable area="Texts">Reload to try again.</Unavailable>;
  if (threads.length === 0) return <Empty title="No texts yet">Texts to the business number land here.</Empty>;
  return (
    <WorkList label="Texts" headings={["Person", "Last message"]}>
      {threads.map((t) => (
        <WorkRow
          key={t.phone}
          href={`/office/inbox/${encodeURIComponent(t.phone)}`}
          title={t.name ?? formatPhone(t.phone)}
          detail={`${t.lastDirection === "out" ? "You: " : ""}${t.lastBody || "(photo)"} · ${formatDateTime(t.lastAt)}`}
          aside={t.unread > 0 ? <StatusPill tone="warning">{t.unread === 1 ? "1 new" : `${t.unread} new`}</StatusPill> : undefined}
        />
      ))}
    </WorkList>
  );
}

async function CallLog({ supabase }: { supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }) {
  const { data, error } = await supabase
    .from("phone_calls")
    .select("id, from_number, status, direction, after_hours, duration_seconds, recording_url, recording_seconds, created_at, lead_id, customer_id, leads(name), customers(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return <Unavailable area="Calls">Reload to try again.</Unavailable>;
  if ((data ?? []).length === 0) return <Empty title="No calls yet">Calls to the business number land here, with any voicemail.</Empty>;
  return (
    <ul aria-label="Calls" className="space-y-3">
      {(data ?? []).map((c) => {
        const lead = Array.isArray(c.leads) ? c.leads[0] : c.leads;
        const customer = Array.isArray(c.customers) ? c.customers[0] : c.customers;
        const who = lead?.name ?? customer?.name ?? formatPhone(c.from_number);
        const result = (c.direction === "out" ? CALL_OUT_STATUS : CALL_STATUS)[c.status] ?? { label: c.status, tone: "neutral" as Tone };
        return (
          <li key={c.id} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 rounded-row border border-border/60 bg-surface px-4 py-3.5 sm:px-[18px]">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold break-words sm:text-base">
                {c.lead_id ? <Link className="hover:underline" href={`/office/leads/${c.lead_id}`}>{who}</Link>
                  : c.customer_id ? <Link className="hover:underline" href={`/office/customers/${c.customer_id}`}>{who}</Link> : who}
              </span>
              <span className="mt-1 block text-xs text-muted sm:text-sm">
                {formatDateTime(c.created_at)} · <a className="underline" href={`tel:${c.from_number}`}>{formatPhone(c.from_number)}</a>
                {c.after_hours && " · after hours"}
                {c.status === "answered" && c.duration_seconds ? ` · ${Math.max(1, Math.round(c.duration_seconds / 60))} min` : ""}
              </span>
            </span>
            {c.recording_url && <audio controls preload="none" src={`/api/twilio/recording/${c.id}`} className="h-8 max-w-full" aria-label={`Voicemail from ${who}`} />}
            <StatusPill tone={result.tone}>{result.label}</StatusPill>
          </li>
        );
      })}
    </ul>
  );
}
