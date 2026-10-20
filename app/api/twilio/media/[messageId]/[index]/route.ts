import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { twilioAuthHeader } from "@/lib/phone/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** A photo someone texted in, for signed-in staff. */
export async function GET(_req: Request, ctx: RouteContext<"/api/twilio/media/[messageId]/[index]">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { messageId, index } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data: message } = await supabase.from("messages").select("media_urls").eq("id", messageId).maybeSingle();
  const url = message?.media_urls?.[Number(index)];
  const auth = twilioAuthHeader();
  if (!url || !auth || !url.startsWith("https://api.twilio.com/")) return new NextResponse("Not found", { status: 404 });
  // Twilio answers media URLs with a redirect to a signed CDN URL; fetch follows it.
  const upstream = await fetch(url, { headers: { authorization: auth }, cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("Media unavailable", { status: 502 });
  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=600",
    },
  });
}
