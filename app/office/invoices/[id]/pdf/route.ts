import { NextResponse } from "next/server";
import { getMember, isStaff } from "@/lib/auth";
import { loadQuickInvoice } from "@/lib/billing/quick-invoice";
import { companyToday } from "@/lib/dates";
import { renderQuickInvoicePdf } from "@/lib/pdf/render";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** The quick invoice as a PDF: the preview for a draft, the copy to send for an issued one. */
export async function GET(_request: Request, { params }: RouteContext<"/office/invoices/[id]/pdf">) {
  const member = await getMember();
  if (!member || !isStaff(member.role)) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  // Read with the staff member's client, so RLS scopes it to their company.
  const invoice = await loadQuickInvoice(await createSupabaseServerClient(), id);
  if (!invoice) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderQuickInvoicePdf(invoice, companyToday());
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="invoice-${invoice.number}${invoice.status === "draft" ? "-draft" : ""}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
