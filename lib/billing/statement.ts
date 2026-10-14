import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "@/lib/dates";
import { one } from "@/lib/office/team";

export type StatementView = {
  id: string;
  number: number;
  issuedOn: string;
  dueOn: string;
  status: "open" | "paid" | "void";
  sentAt: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  brand: { name: string; phone: string | null; email: string | null; address: string | null };
  customer: { name: string; billingEmail: string | null };
  invoices: Array<{
    number: number;
    address: string;
    dates: string;
    totalCents: number;
    lines: Array<{ description: string; amountCents: number }>;
  }>;
  payments: Array<{ amountCents: number; method: string; reference: string | null; receivedOn: string }>;
};

const LINE_ORDER = ["delivery", "extended_days", "tonnage", "adjustment"];

const SELECT = `
  id, number, issued_on, due_on, status, sent_at, total_cents,
  customers(name, billing_email),
  payments(amount_cents, method, reference, received_on),
  invoices(number, total_cents,
    invoice_lines(kind, description, amount_cents),
    rentals(dropped_at, picked_up_at, sites(address), brands(display_name, phone, email, address)))
`;

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase embeds are untyped here; shaped below. */
export function shapeStatement(row: any): StatementView {
  const invoices = [...(row.invoices ?? [])]
    .sort((a, b) => a.number - b.number)
    .map((invoice: any) => {
      const rental = one(invoice.rentals) as any;
      const dropped = rental?.dropped_at ? formatDate(rental.dropped_at.slice(0, 10)) : null;
      const picked = rental?.picked_up_at ? formatDate(rental.picked_up_at.slice(0, 10)) : null;
      return {
        number: invoice.number,
        address: one(rental?.sites as any)?.address ?? "",
        dates: [dropped, picked].filter(Boolean).join(" – "),
        totalCents: invoice.total_cents,
        lines: [...(invoice.invoice_lines ?? [])]
          .sort((a: any, b: any) => LINE_ORDER.indexOf(a.kind) - LINE_ORDER.indexOf(b.kind))
          .map((line: any) => ({ description: line.description, amountCents: line.amount_cents })),
      };
    });
  const payments = (row.payments ?? []).map((p: any) => ({
    amountCents: p.amount_cents,
    method: p.method,
    reference: p.reference,
    receivedOn: p.received_on,
  }));
  const paidCents = payments.reduce((sum: number, p: { amountCents: number }) => sum + p.amountCents, 0);
  const brand = (row.invoices ?? [])
    .map((invoice: any) => one((one(invoice.rentals) as any)?.brands))
    .find(Boolean) as any;
  const customer = one(row.customers) as any;
  return {
    id: row.id,
    number: row.number,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    status: row.status,
    sentAt: row.sent_at,
    totalCents: row.total_cents,
    paidCents,
    balanceCents: Math.max(row.total_cents - paidCents, 0),
    brand: {
      name: brand?.display_name ?? "American Prime Construction",
      phone: brand?.phone ?? null,
      email: brand?.email ?? null,
      address: brand?.address ?? null,
    },
    customer: { name: customer?.name ?? "", billingEmail: customer?.billing_email ?? null },
    invoices,
    payments,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Works with the staff client (RLS) or the service client (cron). */
export async function loadStatement(supabase: SupabaseClient, id: string): Promise<StatementView | null> {
  const { data } = await supabase.from("statements").select(SELECT).eq("id", id).maybeSingle();
  return data ? shapeStatement(data) : null;
}
