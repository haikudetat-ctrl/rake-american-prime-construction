import { readTwilioRequest, twiml } from "@/lib/phone/server";
import { dialAnswered, hangupTwiml } from "@/lib/phone/twiml";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** The customer leg ended: record whether they picked up and for how long. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const { CallSid, DialCallStatus, DialCallDuration } = read.params;
  await adminClient().rpc("finish_outbound_call", {
    p_call_sid: CallSid,
    p_answered: dialAnswered(DialCallStatus),
    p_duration_seconds: Number(DialCallDuration ?? 0) || 0,
  });
  return twiml(hangupTwiml());
}
