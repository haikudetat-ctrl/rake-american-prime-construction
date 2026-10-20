import Link from "next/link";
import { notFound } from "next/navigation";
import { sendText } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
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

  const [{ data: messages }, { data: optOut }, { data: lead }, { data: customer }] = await Promise.all([
    supabase.from("messages").select("id, direction, body, media_urls, status, error, created_at").eq("phone", phone)
      .order("created_at").limit(300),
    supabase.from("sms_opt_outs").select("opted_out_at").eq("phone", phone).is("opted_in_at", null).maybeSingle(),
    supabase.from("leads").select("id, name, stage").eq("phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("customers").select("id, name").eq("phone", phone).limit(1).maybeSingle(),
  ]);
  // Opening the thread marks it read.
  if ((messages ?? []).some((m) => m.direction === "in")) await supabase.rpc("mark_thread_read", { p_phone: phone });

  const returnTo = `/office/inbox/${encodeURIComponent(phone)}`;
  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href="/office/inbox">← Inbox</Link></p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">{lead?.name ?? customer?.name ?? formatPhone(phone)}</h1>
        <div className="flex gap-3 text-sm">
          <a className="underline" href={`tel:${phone}`}>Call {formatPhone(phone)}</a>
          {lead && <Link className="underline" href={`/office/leads/${lead.id}`}>Lead</Link>}
          {customer && <Link className="underline" href={`/office/customers/${customer.id}`}>Customer</Link>}
        </div>
      </div>

      <section className="card space-y-2">
        {(messages ?? []).map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === "out" ? "bg-accent text-accent-foreground" : "bg-background"}`}>
              {m.body && <p className="whitespace-pre-line">{m.body}</p>}
              {(m.media_urls ?? []).map((_: string, i: number) => (
                <a key={i} href={`/api/twilio/media/${m.id}/${i}`} target="_blank" rel="noreferrer" className="block underline">
                  Photo {i + 1}
                </a>
              ))}
              <p className="mt-1 text-[11px] opacity-75">
                {formatDateTime(m.created_at)}
                {m.direction === "out" && ` · ${STATUS[m.status] ?? m.status}`}
                {m.error && ` (${m.error})`}
              </p>
            </div>
          </div>
        ))}
        {(messages ?? []).length === 0 && <p className="text-sm text-muted">No texts with this number yet.</p>}
      </section>

      {optOut ? (
        <p className="card text-sm text-warn">
          This number replied STOP on {formatDateTime(optOut.opted_out_at)}. We can&apos;t text them until they text START.
        </p>
      ) : (
        <form action={sendText} className="card flex gap-2">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea name="body" required rows={2} maxLength={1600} className="input flex-1" placeholder="Reply from the business number…" />
          <button className="btn self-end">Send</button>
        </form>
      )}
    </>
  );
}
