import Link from "next/link";
import { notFound } from "next/navigation";
import { sendText } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Callout } from "@/app/_ui/callout";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Unavailable } from "@/app/_ui/states";
import { requireStaff } from "@/lib/auth";
import { STAGE_LABEL, type Stage } from "@/lib/leads/schema";
import { formatDateTime } from "@/lib/dates";
import { formatPhone, toE164 } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS: Record<string, string> = { queued: "Sending…", sent: "Sent", failed: "Not delivered" };

export default async function ThreadPage({ params, searchParams }: PageProps<"/office/inbox/[phone]">) {
  await requireStaff();
  const phone = toE164(decodeURIComponent((await params).phone));
  if (!phone) notFound();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: messages, error: messagesError }, { data: optOut, error: optOutError }, { data: lead }, { data: customer }] = await Promise.all([
    supabase.from("messages").select("id, direction, body, media_urls, status, error, created_at").eq("phone", phone)
      .order("created_at").limit(300),
    supabase.from("sms_opt_outs").select("opted_out_at").eq("phone", phone).is("opted_in_at", null).maybeSingle(),
    supabase.from("leads").select("id, name, stage").eq("phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("customers").select("id, name").eq("phone", phone).limit(1).maybeSingle(),
  ]);
  // Opening the thread marks it read.
  if ((messages ?? []).some((m) => m.direction === "in")) await supabase.rpc("mark_thread_read", { p_phone: phone });

  const returnTo = `/office/inbox/${encodeURIComponent(phone)}`;
  const name = lead?.name ?? customer?.name ?? formatPhone(phone);
  // If the opt-out check fails, assume texting is paused rather than risk texting someone who said STOP.
  const paused = Boolean(optOut) || Boolean(optOutError);
  return (
    <>
      <Notice searchParams={query} />
      <header className="space-y-1">
        <p className="eyebrow"><Link className="hover:underline" href="/office/inbox">‹ Inbox</Link> · Texts</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{name}</h1>
          <a className="btn-secondary ml-auto" href={`tel:${phone}`}>Call</a>
        </div>
        <p className="text-muted">{formatPhone(phone)}</p>
      </header>

      <WithRail
        rail={
          <>
            <RailCard title="Connected to this number">
              {lead || customer ? (
                <ul className="space-y-1.5">
                  {lead && <li><Link className="font-semibold text-accent hover:underline" href={`/office/leads/${lead.id}`}>Lead · {lead.name}</Link><span className="block text-xs text-muted">Stage · {STAGE_LABEL[lead.stage as Stage] ?? lead.stage}</span></li>}
                  {customer && <li><Link className="font-semibold text-accent hover:underline" href={`/office/customers/${customer.id}`}>Customer · {customer.name}</Link></li>}
                </ul>
              ) : <p className="text-muted">No lead or customer has this number yet.</p>}
              <p className="text-xs text-muted">Links open separate records. Changing a lead or customer there doesn&apos;t change these texts.</p>
            </RailCard>
            <RailCard title="Calls and voicemail">
              <Link className="text-sm font-semibold text-accent hover:underline" href="/office/inbox?tab=calls">Open the call log</Link>
              <p className="text-xs text-muted">Answered and missed calls, with any voicemail to play.</p>
            </RailCard>
            <RailCard title="What each status means">
              <dl className="space-y-1 text-xs">
                <div><dt className="inline font-semibold">Sending…</dt> <dd className="inline text-muted">queued, not sent yet</dd></div>
                <div><dt className="inline font-semibold">Sent</dt> <dd className="inline text-muted">sent, not proof it was read</dd></div>
                <div><dt className="inline font-semibold">Not delivered</dt> <dd className="inline text-muted">failed; the reason shows on the text</dd></div>
              </dl>
            </RailCard>
          </>
        }
      >
        {messagesError ? (
          <Unavailable area="This conversation">Reload to try again.</Unavailable>
        ) : (
          <section aria-label={`Texts with ${name}`} className="card space-y-2">
            {(messages ?? []).map((m) => (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === "out" ? "bg-accent text-accent-foreground" : "bg-sunken"}`}>
                  {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                  {(m.media_urls ?? []).map((_: string, i: number) => (
                    <a key={i} href={`/api/twilio/media/${m.id}/${i}`} target="_blank" rel="noreferrer" className="block underline">
                      Photo {i + 1}
                    </a>
                  ))}
                  <p className="mt-1 text-xs opacity-75">
                    {formatDateTime(m.created_at)} · {m.direction === "out" ? (STATUS[m.status] ?? m.status) : "Received"}
                    {m.error && ` (${m.error})`}
                  </p>
                </div>
              </div>
            ))}
            {(messages ?? []).length === 0 && <p className="text-sm text-muted">No texts with this number yet.</p>}
          </section>
        )}

        {paused ? (
          <Callout tone="warning" title="Texting is paused" role="status">
            {optOut
              ? <>This number replied STOP on {formatDateTime(optOut.opted_out_at)}. They have to text START before anyone can text them again.</>
              : <>We couldn&apos;t check whether this number opted out, so sending is off for now. Reload to try again.</>}
            {" "}No text can be sent from this conversation.
          </Callout>
        ) : (
          <form action={sendText} className="card space-y-2">
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="sr-only" htmlFor="reply">Reply</label>
            <textarea id="reply" name="body" required rows={3} maxLength={1600} className="input w-full" placeholder="Reply from the business number…" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">Up to 1,600 characters. Sent from the business number.</p>
              <button className="btn">Send</button>
            </div>
          </form>
        )}
      </WithRail>
    </>
  );
}
