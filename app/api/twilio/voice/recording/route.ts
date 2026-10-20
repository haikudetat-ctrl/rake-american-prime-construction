import { NextResponse } from "next/server";
import { readTwilioRequest } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Recording status callback: attach the voicemail to the call and tell the office. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration, RecordingStatus } = read.params;
  if (RecordingStatus && RecordingStatus !== "completed") return new NextResponse(null, { status: 204 });
  const seconds = Number(RecordingDuration ?? 0) || 0;
  // Twilio records a second or two of silence when someone hangs up at the beep.
  if (seconds >= 2) {
    await adminClient().rpc("attach_voicemail", {
      p_call_sid: CallSid,
      p_recording_sid: RecordingSid,
      p_recording_url: RecordingUrl,
      p_seconds: seconds,
    });
  }
  return new NextResponse(null, { status: 204 });
}
