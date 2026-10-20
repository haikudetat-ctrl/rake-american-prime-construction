import { NextResponse } from "next/server";
import { proposalPdf } from "@/lib/proposals/pdf";
import { loadFullProposal } from "@/lib/proposals/server";

export const runtime = "nodejs";

/** The homeowner's copy: the proposal, or the signed agreement with its signing record. */
export async function GET(_req: Request, ctx: RouteContext<"/p/[token]/pdf">) {
  const { token } = await ctx.params;
  const p = /^[A-Za-z0-9_-]{32,64}$/.test(token) ? await loadFullProposal({ token }) : null;
  if (!p || p.status === "draft") return new NextResponse("Not found", { status: 404 });
  const pdf = await proposalPdf(p);
  const name = `${p.signature ? "agreement" : "proposal"}-${p.content.number}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store" },
  });
}
