import { dialAnswered, hangupTwiml, voicemailTwiml } from "@/lib/phone/twiml";
import { loadPhoneSettings, readTwilioRequest, twiml, webhookUrl } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** The ring list finished. Answered: done. Otherwise: greeting and voicemail. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const { CallSid, To, DialCallStatus, DialCallDuration } = read.params;
  const answered = dialAnswered(DialCallStatus);
  await adminClient().rpc("finish_call", {
    p_call_sid: CallSid,
    p_answered: answered,
    p_duration_seconds: Number(DialCallDuration ?? 0) || 0,
  });
  if (answered) return twiml(hangupTwiml());
  const settings = await loadPhoneSettings({ number: To });
  return twiml(voicemailTwiml({
    greeting: settings.greeting,
    doneUrl: webhookUrl("/api/twilio/voice/voicemail-done"),
    recordingUrl: webhookUrl("/api/twilio/voice/recording"),
  }));
}
