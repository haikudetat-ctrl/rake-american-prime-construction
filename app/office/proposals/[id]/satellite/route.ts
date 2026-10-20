import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { satelliteImage } from "@/lib/geo/satellite";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/office/proposals/[id]/satellite">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { id } = await ctx.params;
  const { data } = await (await createSupabaseServerClient())
    .from("proposals").select("leads(address, lat, lng)").eq("id", id).maybeSingle();
  const lead = data ? (Array.isArray(data.leads) ? data.leads[0] : data.leads) : null;
  const image = lead ? await satelliteImage(lead).catch(() => null) : null;
  if (!image) return new NextResponse("No image", { status: 404 });
  return new NextResponse(new Uint8Array(image), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" } });
}
