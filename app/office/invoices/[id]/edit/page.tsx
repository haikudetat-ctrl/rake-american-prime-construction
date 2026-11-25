import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Unavailable } from "@/app/office/_unavailable";
import { requireStaff } from "@/lib/auth";
import { loadQuickInvoice, loadQuickInvoiceContext, toDraft } from "@/lib/billing/quick-invoice";
import { companyToday } from "@/lib/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { QuickInvoiceForm } from "../../_form";

/** Change a draft. Issued invoices are voided and made again instead. */
export default async function EditQuickInvoicePage({ params }: PageProps<"/office/invoices/[id]/edit">) {
  await requireStaff();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [invoice, context] = await Promise.all([loadQuickInvoice(supabase, id), loadQuickInvoiceContext(supabase)]);
  if (!invoice) notFound();
  if (invoice.status !== "draft") redirect(`/office/invoices/${id}?error=${encodeURIComponent("Only a draft can be changed. Void this one and make a new one instead.")}`);
  if (!context) return <Unavailable eyebrow="Office · Invoices" area={`Invoice #${invoice.number}`} />;
  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow"><Link className="hover:underline" href={`/office/invoices/${id}`}>Office · Invoices · #{invoice.number}</Link></p>
        <h1 className="page-title">Edit draft #{invoice.number}</h1>
      </header>
      <QuickInvoiceForm context={context} today={companyToday()} invoiceId={id} initial={toDraft(invoice)} />
    </>
  );
}
