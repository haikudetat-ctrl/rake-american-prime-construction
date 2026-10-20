import { isOpen, ringTwiml, voicemailTwiml } from "@/lib/phone/twiml";
import { loadPhoneSettings, readTwilioRequest, twiml, webhookUrl } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Voice webhook for the business number (Twilio console → the number → "A call
 * comes in"). Open hours with a ring list: ring everyone. Otherwise straight
 * to the after-hours greeting and voicemail.
 */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const { CallSid, From, To } = read.params;
  const settings = await loadPhoneSettings({ number: To });
  const open = isOpen(settings) && settings.ringNumbers.length > 0;

  const db = adminClient();
  await db.rpc("record_inbound_call", { p_call_sid: CallSid, p_from: From, p_to: To, p_after_hours: !open });

  if (open) {
    return twiml(ringTwiml({
      numbers: settings.ringNumbers,
      callerId: From,
      timeoutSeconds: settings.ringSeconds,
      screenUrl: webhookUrl("/api/twilio/voice/screen"),
      doneUrl: webhookUrl("/api/twilio/voice/dial-done"),
    }));
  }
  await db.rpc("finish_call", { p_call_sid: CallSid, p_answered: false, p_duration_seconds: 0 });
  return twiml(voicemailTwiml({
    greeting: settings.afterHoursGreeting,
    doneUrl: webhookUrl("/api/twilio/voice/voicemail-done"),
    recordingUrl: webhookUrl("/api/twilio/voice/recording"),
  }));
}
