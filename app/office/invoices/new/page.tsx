import Link from "next/link";
import { Unavailable } from "@/app/office/_unavailable";
import { requireStaff } from "@/lib/auth";
import { loadQuickInvoiceContext } from "@/lib/billing/quick-invoice";
import { companyToday } from "@/lib/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { QuickInvoiceForm } from "../_form";

/** Quick invoice: the one-off invoice the Today button opens. */
export default async function NewQuickInvoicePage() {
  await requireStaff();
  const context = await loadQuickInvoiceContext(await createSupabaseServerClient());
  if (!context || context.brands.length === 0) return <Unavailable eyebrow="Office · Invoices" area="Quick invoice" />;
  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow"><Link className="hover:underline" href="/office/invoices">Office · Invoices</Link></p>
        <h1 className="page-title">Quick invoice</h1>
        <p className="text-muted">Type the lines, or pick them from a price list. It saves as a draft you can preview before anything is sent.</p>
      </header>
      <QuickInvoiceForm context={context} today={companyToday()} />
    </>
  );
}
