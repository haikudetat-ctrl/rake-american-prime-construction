import { callerAnnouncement, screenTwiml } from "@/lib/phone/twiml";
import { readTwilioRequest, twiml, webhookUrl } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CALL_SID = /^CA[0-9a-fA-F]{32}$/;

/**
 * Whisper to the phone that picked up: who is calling, then press 1 to take
 * the business call. The ring leg shows the business number as caller ID, so
 * the original caller comes from the inbound call's record (its SID is in
 * the signed screen URL; Twilio's ParentCallSid is the fallback).
 */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const db = adminClient();
  const { data: brand } = await db.from("brands").select("display_name").eq("kind", "roofing").limit(1).maybeSingle();

  const fromUrl = new URL(req.url).searchParams.get("call") ?? "";
  const parentSid = CALL_SID.test(fromUrl) ? fromUrl : read.params.ParentCallSid ?? "";
  let caller: string | null = null;
  if (CALL_SID.test(parentSid)) {
    try {
      caller = await announceCaller(db, parentSid);
    } catch {
      caller = null; // never let a lookup failure drop the call
    }
  }
  return twiml(screenTwiml({
    brandName: brand?.display_name ?? "the business",
    caller,
    doneUrl: webhookUrl("/api/twilio/voice/screen-done"),
  }));
}

/** The caller's lead (open first, newest), else dumpster customer, else their number. */
async function announceCaller(db: ReturnType<typeof adminClient>, callSid: string): Promise<string | null> {
  const { data: call } = await db.from("phone_calls").select("company_id, from_number").eq("call_sid", callSid).maybeSingle();
  if (!call?.from_number) return null;
  const { data: leads } = await db
    .from("leads")
    .select("name, stage, created_at")
    .eq("company_id", call.company_id)
    .eq("phone", call.from_number)
    .order("created_at", { ascending: false })
    .limit(10);
  const lead = (leads ?? []).find((l) => !["won", "lost"].includes(l.stage)) ?? leads?.[0];
  let name = lead?.name ?? null;
  if (!name) {
    const { data: customer } = await db
      .from("customers")
      .select("name")
      .eq("company_id", call.company_id)
      .eq("phone", call.from_number)
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    name = customer?.name ?? null;
  }
  return callerAnnouncement({ name, phone: call.from_number });
}
