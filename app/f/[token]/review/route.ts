import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Logs the click, then sends a happy homeowner to the Google review page. */
export async function GET(req: Request, ctx: RouteContext<"/f/[token]/review">) {
  const { token } = await ctx.params;
  const back = new URL(`/f/${token}`, req.url);
  if (!/^[0-9a-f]{64}$/.test(token)) return NextResponse.redirect(back);
  const { data: url } = await adminClient().rpc("record_review_click", { p_token: token });
  return NextResponse.redirect(typeof url === "string" && url.startsWith("https://") ? url : back);
}
