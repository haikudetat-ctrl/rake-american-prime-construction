import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { renderSubInvoicePdf } from "@/lib/pdf/render";
import { loadSubInvoice } from "@/lib/subcontract/invoice";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** The contractor invoice for a subcontract job (the live one, or the newest void one). */
export async function GET(_request: Request, { params }: RouteContext<"/office/subs/[id]/invoice">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  // Read with the staff member's client, so RLS scopes it to their company.
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase.from("sub_invoices").select("id, status").eq("job_id", id).order("created_at", { ascending: false });
  const pick = (rows ?? []).find((r) => r.status !== "void") ?? rows?.[0];
  const invoice = pick ? await loadSubInvoice(supabase, pick.id) : null;
  if (!invoice) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderSubInvoicePdf(invoice);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="invoice-${invoice.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
