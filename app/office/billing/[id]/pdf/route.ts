import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { loadStatement } from "@/lib/billing/statement";
import { renderStatementPdf } from "@/lib/pdf/render";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteContext<"/office/billing/[id]/pdf">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  // Loaded with the staff member's client, so RLS scopes it to their company.
  const statement = await loadStatement(await createSupabaseServerClient(), id);
  if (!statement) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderStatementPdf(statement);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="statement-${statement.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
