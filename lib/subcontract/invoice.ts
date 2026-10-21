import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/office/team";
import { jobLines, type InvoiceLine } from "@/lib/subcontract/view";

/** A contractor invoice for one subcontract job, as the page, PDF and email show it. */
export type SubInvoiceView = {
  id: string;
  number: number;
  issuedOn: string;
  dueOn: string;
  status: "open" | "paid" | "void";
  voidReason: string | null;
  sentAt: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  brand: { name: string; phone: string | null; email: string | null; address: string | null };
  contractor: { name: string; billingEmail: string | null };
  job: { id: string; address: string; workDate: string; squares: number; pitch: number };
  lines: InvoiceLine[];
  payments: Array<{ id: string; amountCents: number; method: string; reference: string | null; receivedOn: string }>;
};

const SELECT = `
  id, number, issued_on, due_on, status, void_reason, sent_at, total_cents, company_id,
  sub_contractors(name, billing_email),
  sub_payments(id, amount_cents, method, reference, received_on, voided_at),
  sub_jobs(id, address, work_date, squares, pitch, bill_base_cents, bill_pitch_cents,
    sub_job_extras(description, qty, bill_unit_cents, created_at))
`;

/**
 * Loads an invoice with the caller's client (RLS scopes it to staff of the
 * company) or the service role (the outbox). Null if it isn't visible.
 */
export async function loadSubInvoice(db: SupabaseClient, id: string): Promise<SubInvoiceView | null> {
  const { data: row } = await db.from("sub_invoices").select(SELECT).eq("id", id).maybeSingle();
  if (!row) return null;
  const { data: brand } = await db
    .from("brands")
    .select("display_name, phone, email, address")
    .eq("company_id", row.company_id)
    .eq("kind", "roofing")
    .maybeSingle();

  /* eslint-disable @typescript-eslint/no-explicit-any -- Supabase embeds are untyped here; shaped below. */
  const job = one(row.sub_jobs as any) as any;
  const contractor = one(row.sub_contractors as any) as any;
  const extras = [...(job?.sub_job_extras ?? [])]
    .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((e: any) => ({ description: e.description, qty: Number(e.qty), unitCents: e.bill_unit_cents }));
  const payments = ((row.sub_payments as any[]) ?? [])
    .filter((p) => !p.voided_at)
    .map((p) => ({ id: p.id, amountCents: p.amount_cents, method: p.method, reference: p.reference, receivedOn: p.received_on }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  return {
    id: row.id,
    number: row.number,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    status: row.status,
    voidReason: row.void_reason,
    sentAt: row.sent_at,
    totalCents: row.total_cents,
    paidCents,
    balanceCents: row.total_cents - paidCents,
    brand: {
      name: brand?.display_name ?? "American Prime Construction",
      phone: brand?.phone ?? null,
      email: brand?.email ?? null,
      address: brand?.address ?? null,
    },
    contractor: { name: contractor?.name ?? "", billingEmail: contractor?.billing_email ?? null },
    job: {
      id: job?.id,
      address: job?.address ?? "",
      workDate: job?.work_date,
      squares: Number(job?.squares ?? 0),
      pitch: job?.pitch ?? 0,
    },
    // Lines are laid out from the rates frozen on the job when it closed.
    lines: job?.squares
      ? jobLines(
          { squares: Number(job.squares), pitch: job.pitch, baseCents: job.bill_base_cents ?? 0, pitchCents: job.bill_pitch_cents ?? 0 },
          extras,
        )
      : [],
    payments,
  };
}
