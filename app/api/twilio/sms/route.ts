import { emptyTwiml } from "@/lib/phone/twiml";
import { readTwilioRequest, twiml } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Incoming texts (Twilio console → Messaging Service → Integration → "Send a
 * webhook"). Stored in the inbox; no auto-reply. Twilio's Messaging Service
 * answers STOP/HELP itself.
 */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const { MessageSid, From, To, Body, NumMedia } = read.params;
  const media = Array.from({ length: Math.min(Number(NumMedia ?? 0) || 0, 10) }, (_, i) => read.params[`MediaUrl${i}`])
    .filter((u): u is string => Boolean(u));
  const { error } = await adminClient().rpc("receive_text", {
    p_sid: MessageSid,
    p_from: From,
    p_to: To,
    p_body: Body ?? "",
    p_media: media,
  });
  // A failure here makes Twilio retry; receive_text is idempotent on the sid.
  if (error) return new Response("Could not store message", { status: 500 });
  return twiml(emptyTwiml());
}
