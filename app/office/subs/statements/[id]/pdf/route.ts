import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { renderSubStatementPdf } from "@/lib/pdf/render";
import { loadSubStatement } from "@/lib/subcontract/statement";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteContext<"/office/subs/statements/[id]/pdf">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  // Read with the staff member's client, so RLS scopes it to their company.
  const statement = await loadSubStatement(await createSupabaseServerClient(), id);
  if (!statement) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderSubStatementPdf(statement);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="statement-${statement.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
