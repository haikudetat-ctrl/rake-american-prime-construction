import { NextResponse } from "next/server";
import { readTwilioRequest } from "@/lib/phone/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * The whole call ended. If it never reached the customer (the staff member
 * didn't answer or didn't press 1), close it as not connected; a call that did
 * connect was already closed by outbound/done, so this changes nothing.
 */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  await adminClient().rpc("finish_outbound_call", { p_call_sid: read.params.CallSid, p_answered: false, p_duration_seconds: 0 });
  return new NextResponse(null, { status: 204 });
}
