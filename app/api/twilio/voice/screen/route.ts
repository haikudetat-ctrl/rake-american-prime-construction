import { screenTwiml } from "@/lib/phone/twiml";
import { readTwilioRequest, twiml, webhookUrl } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Whisper to the phone that picked up: press 1 to take the business call. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const { data } = await adminClient().from("brands").select("display_name").eq("kind", "roofing").limit(1).maybeSingle();
  return twiml(screenTwiml({ brandName: data?.display_name ?? "the business", doneUrl: webhookUrl("/api/twilio/voice/screen-done") }));
}
