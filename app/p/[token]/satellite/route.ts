import { NextResponse } from "next/server";
import { satelliteImage } from "@/lib/geo/satellite";
import { loadFullProposal } from "@/lib/proposals/server";

export const runtime = "nodejs";

/** Satellite photo for a sent proposal, so the API key stays on the server. */
export async function GET(_req: Request, ctx: RouteContext<"/p/[token]/satellite">) {
  const { token } = await ctx.params;
  const p = /^[A-Za-z0-9_-]{32,64}$/.test(token) ? await loadFullProposal({ token }) : null;
  if (!p || p.status === "draft") return new NextResponse("Not found", { status: 404 });
  const image = await satelliteImage(p.lead).catch(() => null);
  if (!image) return new NextResponse("No image", { status: 404 });
  return new NextResponse(new Uint8Array(image), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" } });
}
