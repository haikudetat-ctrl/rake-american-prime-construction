import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { twilioAuthHeader } from "@/lib/phone/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Plays a voicemail to signed-in staff. Twilio recordings need our credentials, so we fetch and pass it through. */
export async function GET(_req: Request, ctx: RouteContext<"/api/twilio/recording/[callId]">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { callId } = await ctx.params;
  // RLS limits this to the member's company.
  const supabase = await createSupabaseServerClient();
  const { data: call } = await supabase.from("phone_calls").select("recording_url").eq("id", callId).maybeSingle();
  const auth = twilioAuthHeader();
  if (!call?.recording_url || !auth || !call.recording_url.startsWith("https://api.twilio.com/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const upstream = await fetch(`${call.recording_url}.mp3`, { headers: { authorization: auth }, cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("Recording unavailable", { status: 502 });
  return new NextResponse(upstream.body, {
    headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=600" },
  });
}
