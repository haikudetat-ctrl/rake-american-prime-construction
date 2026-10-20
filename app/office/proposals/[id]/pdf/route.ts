import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { proposalPdf } from "@/lib/proposals/pdf";
import { loadFullProposal } from "@/lib/proposals/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Staff preview or copy of a proposal, drafts included. */
export async function GET(_req: Request, ctx: RouteContext<"/office/proposals/[id]/pdf">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { id } = await ctx.params;
  // RLS decides whether this member may see it; the full load then uses the service role.
  const { data } = await (await createSupabaseServerClient()).from("proposals").select("id").eq("id", id).maybeSingle();
  const p = data ? await loadFullProposal({ id }) : null;
  if (!p) return new NextResponse("Not found", { status: 404 });
  const pdf = await proposalPdf(p);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="proposal-${p.content.number}.pdf"` },
  });
}
