import { leadParam, outboundDialTwiml } from "@/lib/phone/outbound";
import { readTwilioRequest, twiml, webhookUrl } from "@/lib/phone/server";
import { hangupTwiml } from "@/lib/phone/twiml";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** 1 dials the customer from the business number; anything else hangs up. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const leadId = leadParam(req.url);
  if (read.params.Digits !== "1" || !leadId) return twiml(hangupTwiml());
  const db = adminClient();
  // The number to dial comes from the lead row, never from the request.
  const [{ data: lead }, { data: call }] = await Promise.all([
    db.from("leads").select("phone").eq("id", leadId).maybeSingle(),
    db.from("phone_calls").select("to_number").eq("call_sid", read.params.CallSid ?? "").eq("direction", "out").maybeSingle(),
  ]);
  if (!lead?.phone || !call?.to_number) return twiml(hangupTwiml());
  return twiml(outboundDialTwiml({
    customer: lead.phone,
    businessNumber: call.to_number,
    doneUrl: webhookUrl("/api/twilio/voice/outbound/done"),
  }));
}
