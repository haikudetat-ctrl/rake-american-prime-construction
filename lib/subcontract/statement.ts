import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/office/team";
import { loadSubInvoice } from "@/lib/subcontract/invoice";
import { jobScope, type InvoiceLine } from "@/lib/subcontract/view";

/** A contractor's weekly statement, as the page, PDF and email show it. */
export type SubStatementView = {
  id: string;
  number: number;
  issuedOn: string;
  dueOn: string;
  periodStart: string;
  periodEnd: string;
  status: "open" | "paid" | "void";
  voidReason: string | null;
  sentAt: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  brand: { name: string; phone: string | null; email: string | null; address: string | null };
  contractor: { id: string; name: string; billingEmail: string | null };
  invoices: Array<{
    id: string;
    number: number;
    jobId: string;
    address: string;
    workDate: string;
    scope: string;
    totalCents: number;
    paidCents: number;
    lines: InvoiceLine[];
  }>;
  payments: Array<{ id: string; invoiceNumber: number; amountCents: number; method: string; reference: string | null; receivedOn: string }>;
};

/**
 * Loads a statement with the caller's client (RLS: staff of the company) or
 * the service role (the outbox). Each job's lines come from its invoice, so the
 * statement says exactly what the per-job invoices say. A void statement has
 * released its invoices, so it lists none.
 */
export async function loadSubStatement(db: SupabaseClient, id: string): Promise<SubStatementView | null> {
  const { data: row } = await db
    .from("sub_statements")
    .select("*, sub_contractors(id, name, billing_email)")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;
  const contractor = one(row.sub_contractors) as { id: string; name: string; billing_email: string | null } | null;
  const { data: invoiceRows } = await db.from("sub_invoices").select("id").eq("statement_id", id).order("number");
  const invoices = (await Promise.all((invoiceRows ?? []).map((r) => loadSubInvoice(db, r.id)))).filter((i) => i !== null);

  let brand = invoices[0]?.brand;
  if (!brand) {
    const { data } = await db.from("brands").select("display_name, phone, email, address")
      .eq("company_id", row.company_id).eq("kind", "roofing").maybeSingle();
    brand = { name: data?.display_name ?? "American Prime Construction", phone: data?.phone ?? null, email: data?.email ?? null, address: data?.address ?? null };
  }

  const paidCents = invoices.reduce((sum, i) => sum + i.paidCents, 0);
  return {
    id: row.id,
    number: row.number,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    voidReason: row.void_reason,
    sentAt: row.sent_at,
    totalCents: row.total_cents,
    paidCents,
    balanceCents: row.total_cents - paidCents,
    brand,
    contractor: { id: contractor?.id ?? "", name: contractor?.name ?? "", billingEmail: contractor?.billing_email ?? null },
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      jobId: i.job.id,
      address: i.job.address,
      workDate: i.job.workDate,
      scope: jobScope(i.job.squares, i.job.pitch),
      totalCents: i.totalCents,
      paidCents: i.paidCents,
      lines: i.lines,
    })),
    payments: invoices
      .flatMap((i) => i.payments.map((p) => ({ ...p, invoiceNumber: i.number })))
      .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.invoiceNumber - b.invoiceNumber),
  };
}
