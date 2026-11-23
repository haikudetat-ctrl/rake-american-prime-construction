import { leadParam, outboundScreenTwiml } from "@/lib/phone/outbound";
import { readTwilioRequest, twiml, webhookUrl } from "@/lib/phone/server";
import { hangupTwiml } from "@/lib/phone/twiml";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** A call out from Rake: the staff member picked up their own phone. Say who it's to, wait for 1. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const leadId = leadParam(req.url);
  if (!leadId) return twiml(hangupTwiml());
  const { data: lead } = await adminClient().from("leads").select("name").eq("id", leadId).maybeSingle();
  if (!lead) return twiml(hangupTwiml());
  return twiml(outboundScreenTwiml({ name: lead.name, connectUrl: webhookUrl(`/api/twilio/voice/outbound/connect?lead=${leadId}`) }));
}
