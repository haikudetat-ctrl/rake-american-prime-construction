import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";

/**
 * Quick invoices: one-off branded invoices typed in the office (custom lines, or
 * lines picked from a price list Rake already keeps). They're on no statement
 * and pay no crew. The database does the arithmetic; the math here only
 * previews it in the form, and mirrors it exactly so the preview never lies.
 */

// Kept here rather than imported from lib/office/team (server-only), since the form uses this module too.
function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export type QuickStatus = "draft" | "open" | "paid" | "void";
export type LineSource = "custom" | "dumpster_price" | "sub_price";

/** Without terms from a customer or contractor, a quick invoice is due in 15 days (the customer default). */
export const DEFAULT_TERMS_DAYS = 15;
export const MAX_LINES = 50;

export type QuickInvoiceView = {
  id: string;
  number: number;
  status: QuickStatus;
  issuedOn: string | null;
  dueOn: string;
  createdAt: string;
  memo: string | null;
  taxPct: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  voidReason: string | null;
  sentAt: string | null;
  sentTo: string | null;
  /** The latest email asked for; still waiting while it's after sentAt. */
  emailQueuedTo: string | null;
  emailQueuedFor: string | null;
  brand: { id: string; kind: string; name: string; phone: string | null; email: string | null; address: string | null };
  billTo: { name: string; email: string | null; phone: string | null; address: string | null };
  from: { customerId: string | null; contractorId: string | null; leadId: string | null };
  lines: Array<{ description: string; quantity: number; unit: string | null; unitCents: number; amountCents: number; source: LineSource; sourceItemId: string | null }>;
  payments: Array<{ id: string; amountCents: number; method: string; reference: string | null; receivedOn: string }>;
};

// Line math -------------------------------------------------------------------------------

/** Same as the database: qty x price, rounded half away from zero to the cent. */
export function lineAmount(quantity: number, unitCents: number): number {
  const exact = quantity * unitCents;
  return Math.sign(exact) * Math.round(Math.abs(exact) + 1e-9);
}

/** Same as the database: tax on the subtotal, rounded to the cent. */
export function invoiceTotals(lines: Array<{ quantity: number; unitCents: number }>, taxPct: number) {
  const subtotalCents = lines.reduce((sum, l) => sum + lineAmount(l.quantity, l.unitCents), 0);
  const taxCents = subtotalCents > 0 ? Math.round((subtotalCents * taxPct) / 100 + 1e-9) : 0;
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** "2", "1.5", "120" → a positive quantity with up to two decimals, or null. */
export function parseQuantity(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= 99_999_999 ? n : null;
}

/** "450", "$1,250.00", "-50" (a credit) → cents, or null. */
export function parsePrice(input: string): number | null {
  const match = input.trim().match(/^(-?)\s*\$?\s*(-?)(.*)$/);
  if (!match || (match[1] && match[2])) return null;
  const cents = parseDollarsToCents(match[3]);
  if (cents === null || cents > 10_000_000) return null;
  return (match[1] || match[2]) && cents > 0 ? -cents : cents;
}

/** "6.625", "6.625%" → a tax rate from 0 to 20, or null. Empty is no tax. */
export function parseTaxPct(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n <= 20 ? n : null;
}

export function defaultDueDate(today: string, termsDays: number | null | undefined = DEFAULT_TERMS_DAYS): string {
  return addDays(today, termsDays ?? DEFAULT_TERMS_DAYS);
}

/** An email asked for that hasn't been confirmed sent since. */
export function emailWaiting(i: Pick<QuickInvoiceView, "emailQueuedFor" | "sentAt" | "status">): boolean {
  if (!i.emailQueuedFor || i.status === "void") return false;
  return !i.sentAt || Date.parse(i.sentAt) < Date.parse(i.emailQueuedFor) - 60_000; // a minute for clock skew
}

/** What a quick invoice's state means for whoever reads the list. */
export function quickState(i: { status: QuickStatus; dueOn: string }, today: string): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (i.status === "void") return { label: "Void", tone: "neutral" };
  if (i.status === "paid") return { label: "Paid", tone: "success" };
  if (i.status === "draft") return { label: "Draft", tone: "neutral" };
  return i.dueOn < today ? { label: "Overdue", tone: "danger" } : { label: "Open", tone: "warning" };
}

// The form's payload ---------------------------------------------------------------------------

export type DraftLine = { key: string; source: LineSource; itemId: string; description: string; quantity: string; unit: string; price: string };
export type DraftInvoice = {
  brandId: string;
  fillFrom: string; // "", "customer:<id>", "contractor:<id>", "lead:<id>"
  name: string;
  email: string;
  phone: string;
  address: string;
  dueOn: string;
  taxPct: string;
  memo: string;
  lines: DraftLine[];
};

export type InvoicePayload = {
  brand_id: string;
  bill_to: { name: string; email: string | null; phone: string | null; address: string | null };
  customer_id: string | null;
  contractor_id: string | null;
  lead_id: string | null;
  due_on: string;
  memo: string | null;
  tax_pct: number;
  lines: Array<{ description: string; quantity: number; unit: string | null; unit_cents: number; source: LineSource; source_item_id: string | null }>;
};

const blank = (s: string) => (s.trim() === "" ? null : s.trim());

/** The form's draft as the database takes it, or the first thing to fix (line numbers count from 1). */
export function toPayload(d: DraftInvoice): { ok: true; payload: InvoicePayload } | { ok: false; error: string; line: number | null } {
  if (!d.brandId) return { ok: false, error: "Pick the brand it goes out under.", line: null };
  if (!d.name.trim()) return { ok: false, error: "Enter who the invoice is for.", line: null };
  if (d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) return { ok: false, error: "That email doesn't look right.", line: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dueOn)) return { ok: false, error: "Pick a due date.", line: null };
  const tax = parseTaxPct(d.taxPct);
  if (tax === null) return { ok: false, error: "Sales tax is a percent from 0 to 20, like 6.625.", line: null };
  const used = d.lines.filter((l) => l.description.trim() || l.price.trim() || l.itemId);
  if (used.length === 0) return { ok: false, error: "Add at least one line.", line: null };
  if (used.length > MAX_LINES) return { ok: false, error: `An invoice can have up to ${MAX_LINES} lines.`, line: null };
  const lines: InvoicePayload["lines"] = [];
  for (const [i, l] of used.entries()) {
    const n = i + 1;
    if (!l.description.trim()) return { ok: false, error: `Line ${n}: describe it.`, line: n };
    const quantity = parseQuantity(l.quantity);
    if (quantity === null) return { ok: false, error: `Line ${n}: enter a quantity, like 1 or 120.`, line: n };
    const unitCents = parsePrice(l.price);
    if (unitCents === null) return { ok: false, error: `Line ${n}: enter a price, like 450 or 1,250.00.`, line: n };
    lines.push({
      description: l.description.trim(),
      quantity,
      unit: blank(l.unit),
      unit_cents: unitCents,
      source: l.source,
      source_item_id: l.source === "custom" ? null : l.itemId || null,
    });
  }
  if (invoiceTotals(lines.map((l) => ({ quantity: l.quantity, unitCents: l.unit_cents })), tax).totalCents < 0) {
    return { ok: false, error: "Credits can't take the invoice below zero.", line: null };
  }
  const [kind, id] = d.fillFrom.split(":");
  return {
    ok: true,
    payload: {
      brand_id: d.brandId,
      bill_to: { name: d.name.trim(), email: blank(d.email)?.toLowerCase() ?? null, phone: blank(d.phone), address: blank(d.address) },
      customer_id: kind === "customer" ? id : null,
      contractor_id: kind === "contractor" ? id : null,
      lead_id: kind === "lead" ? id : null,
      due_on: d.dueOn,
      memo: blank(d.memo),
      tax_pct: tax,
      lines,
    },
  };
}

/** An existing draft back in the form. */
export function toDraft(i: QuickInvoiceView): DraftInvoice {
  const fillFrom = i.from.customerId ? `customer:${i.from.customerId}` : i.from.contractorId ? `contractor:${i.from.contractorId}` : i.from.leadId ? `lead:${i.from.leadId}` : "";
  return {
    brandId: i.brand.id,
    fillFrom,
    name: i.billTo.name,
    email: i.billTo.email ?? "",
    phone: i.billTo.phone ?? "",
    address: i.billTo.address ?? "",
    dueOn: i.dueOn,
    taxPct: i.taxPct ? String(i.taxPct) : "",
    memo: i.memo ?? "",
    lines: i.lines.map((l, n) => ({
      key: `line-${n}`,
      source: l.source,
      itemId: l.sourceItemId ?? "",
      description: l.description,
      quantity: String(l.quantity),
      unit: l.unit ?? "",
      price: (l.unitCents / 100).toFixed(2),
    })),
  };
}

// What the form picks from -----------------------------------------------------------------------

export type StoredItem = { id: string; source: Exclude<LineSource, "custom">; group: string; description: string; unit: string; unitCents: number };
export type BillToOption = { value: string; group: "Customers" | "Contractors" | "Leads"; label: string; name: string; email: string; phone: string; address: string; termsDays: number | null };
export type QuickInvoiceContext = {
  brands: Array<{ id: string; kind: string; name: string }>;
  items: StoredItem[];
  billTo: BillToOption[];
};

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase embeds are untyped here; shaped below. */
export async function loadQuickInvoiceContext(db: SupabaseClient): Promise<QuickInvoiceContext | null> {
  const [brands, dumpsterItems, subItems, customers, contractors, leads] = await Promise.all([
    db.from("brands").select("id, kind, display_name").order("kind", { ascending: false }),
    db.from("dumpster_price_items").select("id, description, unit, unit_cents").eq("is_active", true).order("description"),
    db.from("sub_price_items").select("id, description, unit, bill_unit_cents, sub_contractors(name, is_active)").eq("is_active", true).order("description"),
    db.from("customers").select("id, name, billing_email, phone, payment_terms_days").eq("is_active", true).order("name").limit(500),
    db.from("sub_contractors").select("id, name, billing_email, phone, payment_terms_days").eq("is_active", true).order("name"),
    db.from("leads").select("id, name, email, phone, address").order("created_at", { ascending: false }).limit(200),
  ]);
  if ([brands, dumpsterItems, subItems, customers, contractors, leads].some((r) => r.error)) return null;

  const items: StoredItem[] = [
    ...(dumpsterItems.data ?? []).map((i: any) => ({
      id: i.id, source: "dumpster_price" as const, group: "Dumpster price list", description: i.description, unit: i.unit, unitCents: i.unit_cents,
    })),
    ...(subItems.data ?? [])
      .filter((i: any) => one(i.sub_contractors as any)?.is_active !== false)
      .map((i: any) => ({
        id: i.id, source: "sub_price" as const, group: `${(one(i.sub_contractors as any) as any)?.name ?? "Contractor"} rates`,
        description: i.description, unit: i.unit, unitCents: i.bill_unit_cents,
      })),
  ].sort((a, b) => a.group.localeCompare(b.group) || a.description.localeCompare(b.description));

  return {
    brands: (brands.data ?? []).map((b: any) => ({ id: b.id, kind: b.kind, name: b.display_name })),
    items,
    billTo: [
      ...(customers.data ?? []).map((c: any) => ({
        value: `customer:${c.id}`, group: "Customers" as const, label: c.name, name: c.name, email: c.billing_email ?? "", phone: c.phone ?? "", address: "", termsDays: c.payment_terms_days,
      })),
      ...(contractors.data ?? []).map((c: any) => ({
        value: `contractor:${c.id}`, group: "Contractors" as const, label: c.name, name: c.name, email: c.billing_email ?? "", phone: c.phone ?? "", address: "", termsDays: c.payment_terms_days,
      })),
      ...(leads.data ?? []).map((l: any) => ({
        value: `lead:${l.id}`, group: "Leads" as const, label: [l.name, l.address].filter(Boolean).join(" · "), name: l.name, email: l.email ?? "", phone: l.phone ?? "", address: l.address ?? "", termsDays: null,
      })),
    ],
  };
}

const SELECT = `
  id, number, status, issued_on, due_on, created_at, memo, tax_pct, subtotal_cents, tax_cents, total_cents,
  void_reason, sent_at, sent_to, email_queued_to, email_queued_for, bill_to_name, bill_to_email, bill_to_phone, bill_to_address,
  customer_id, contractor_id, lead_id,
  brands(id, kind, display_name, phone, email, address),
  quick_invoice_lines(position, description, quantity, unit, unit_cents, amount_cents, source, source_item_id),
  quick_invoice_payments(id, amount_cents, method, reference, received_on, voided_at)
`;

export function shapeQuickInvoice(row: any): QuickInvoiceView {
  const brand = one(row.brands as any) as any;
  const payments = ((row.quick_invoice_payments as any[]) ?? [])
    .filter((p) => !p.voided_at)
    .sort((a, b) => String(a.received_on).localeCompare(String(b.received_on)))
    .map((p) => ({ id: p.id, amountCents: p.amount_cents, method: p.method, reference: p.reference, receivedOn: p.received_on }));
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    createdAt: row.created_at,
    memo: row.memo,
    taxPct: Number(row.tax_pct ?? 0),
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    paidCents,
    balanceCents: row.status === "void" ? 0 : row.total_cents - paidCents,
    voidReason: row.void_reason,
    sentAt: row.sent_at,
    sentTo: row.sent_to,
    emailQueuedTo: row.email_queued_to ?? null,
    emailQueuedFor: row.email_queued_for ?? null,
    brand: {
      id: brand?.id ?? "",
      kind: brand?.kind ?? "roofing",
      name: brand?.display_name ?? "American Prime Construction",
      phone: brand?.phone ?? null,
      email: brand?.email ?? null,
      address: brand?.address ?? null,
    },
    billTo: { name: row.bill_to_name, email: row.bill_to_email, phone: row.bill_to_phone, address: row.bill_to_address },
    from: { customerId: row.customer_id, contractorId: row.contractor_id, leadId: row.lead_id },
    lines: [...((row.quick_invoice_lines as any[]) ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitCents: l.unit_cents,
        amountCents: l.amount_cents,
        source: l.source,
        sourceItemId: l.source_item_id,
      })),
    payments,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** With the staff client (RLS) or the service client (the outbox). Null if it isn't visible. */
export async function loadQuickInvoice(db: SupabaseClient, id: string): Promise<QuickInvoiceView | null> {
  const { data } = await db.from("quick_invoices").select(SELECT).eq("id", id).maybeSingle();
  return data ? shapeQuickInvoice(data) : null;
}

/** "120 ft × $6.00", "1 × $450.00", or just the price when it's one of something with no unit. */
export function quantityText(l: { quantity: number; unit: string | null; unitCents: number }, money: (c: number) => string): string {
  const qty = Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(2);
  if (l.quantity === 1 && !l.unit) return money(l.unitCents);
  return `${qty}${l.unit ? ` ${l.unit}` : ""} × ${money(l.unitCents)}`;
}
