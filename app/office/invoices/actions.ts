"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { acknowledged, back, errorText, optional, str } from "@/lib/flash";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { MAX_LINES } from "@/lib/billing/quick-invoice";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Every action re-checks the caller's role; the database checks again in each
// workflow function, and does all of the arithmetic.

async function staffClient() {
  await requireStaff();
  return createSupabaseServerClient();
}

function done(path: string, message: string): never {
  revalidatePath("/office/invoices", "layout");
  revalidatePath("/office");
  back(path, message);
}

const invoicePath = (form: FormData) => `/office/invoices/${str(form, "invoiceId")}`;

const Payload = z.object({
  brand_id: z.guid(),
  bill_to: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().max(200).nullable(),
    phone: z.string().trim().max(40).nullable(),
    address: z.string().trim().max(300).nullable(),
  }),
  customer_id: z.guid().nullable(),
  contractor_id: z.guid().nullable(),
  lead_id: z.guid().nullable(),
  due_on: z.iso.date(),
  memo: z.string().max(2000).nullable(),
  tax_pct: z.number().min(0).max(20),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        quantity: z.number().positive().max(99_999_999),
        unit: z.string().trim().max(20).nullable(),
        unit_cents: z.number().int().min(-10_000_000).max(10_000_000),
        source: z.enum(["custom", "dumpster_price", "sub_price"]),
        source_item_id: z.guid().nullable(),
      }),
    )
    .min(1)
    .max(MAX_LINES),
});

/** Refused: what to fix, and the form keeps what was typed. Saved: where the preview is. */
export type SaveQuickInvoiceState = { ok: false; error: string; at: number } | { ok: true; href: string; at: number } | null;

/**
 * Saves a new draft, or the changes to one, and answers with where its preview
 * is. Nothing is issued or emailed here.
 */
export async function saveQuickInvoice(_previous: SaveQuickInvoiceState, form: FormData): Promise<SaveQuickInvoiceState> {
  const supabase = await staffClient();
  const refuse = (error: string): SaveQuickInvoiceState => ({ ok: false, error, at: Date.now() });
  let payload: z.infer<typeof Payload>;
  try {
    payload = Payload.parse(JSON.parse(str(form, "invoice")));
  } catch {
    return refuse("Something in the form didn't come through. Check the lines and try again.");
  }
  const existing = optional(form, "invoiceId");
  const { data: id, error } = await supabase.rpc("save_quick_invoice", { p_invoice_id: existing, p_invoice: payload });
  if (error) {
    const text = errorText(error);
    return refuse(text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : "."));
  }
  revalidatePath("/office/invoices", "layout");
  revalidatePath("/office");
  const notice = "Draft saved. Check the preview, then issue it.";
  return { ok: true, href: `/office/invoices/${id}?notice=${encodeURIComponent(notice)}`, at: Date.now() };
}

/** Draft to open. Emails it (after a 15-minute hold) only when the box was ticked. */
export async function issueQuickInvoice(form: FormData) {
  const supabase = await staffClient();
  if (!acknowledged(form)) back(invoicePath(form), "Tick the box to confirm the invoice.", "error");
  const sendTo = form.get("email") === "yes" ? optional(form, "sendTo") : null;
  const { error } = await supabase.rpc("issue_quick_invoice", { p_invoice_id: str(form, "invoiceId"), p_send_to: sendTo });
  if (error) back(invoicePath(form), errorText(error), "error");
  done(invoicePath(form), sendTo ? `Issued. It emails to ${sendTo.toLowerCase()} in 15 minutes; void it before then to stop it.` : "Issued. Download the PDF to send it yourself.");
}

export async function sendQuickInvoice(form: FormData) {
  const supabase = await staffClient();
  if (!acknowledged(form)) back(invoicePath(form), "Tick the box to confirm the email.", "error");
  const to = str(form, "sendTo");
  const { error } = await supabase.rpc("send_quick_invoice", { p_invoice_id: str(form, "invoiceId"), p_to: to });
  if (error) back(invoicePath(form), errorText(error), "error");
  done(invoicePath(form), `It emails to ${to.toLowerCase()} in 15 minutes.`);
}

export async function voidQuickInvoice(form: FormData) {
  const supabase = await staffClient();
  if (!acknowledged(form)) back(invoicePath(form), "Tick the box to confirm.", "error");
  const { error } = await supabase.rpc("void_quick_invoice", { p_invoice_id: str(form, "invoiceId"), p_reason: str(form, "reason") });
  if (error) back(invoicePath(form), errorText(error), "error");
  done(invoicePath(form), form.get("draft") === "yes" ? "Draft discarded." : "Invoice voided. Any email still waiting won't go out.");
}

export async function recordQuickPayment(form: FormData) {
  const supabase = await staffClient();
  const amount = parseDollarsToCents(str(form, "amount"));
  if (amount === null) back(invoicePath(form), "Enter the amount, like 450 or 1,250.00.", "error");
  const { error } = await supabase.rpc("record_quick_payment", {
    p_invoice_id: str(form, "invoiceId"),
    p_amount_cents: amount,
    p_method: str(form, "method") || "check",
    p_reference: optional(form, "reference"),
    p_received_on: optional(form, "receivedOn"),
  });
  if (error) back(invoicePath(form), errorText(error), "error");
  done(invoicePath(form), `Payment of ${formatCents(amount)} recorded.`);
}

export async function voidQuickPayment(form: FormData) {
  const supabase = await staffClient();
  if (!acknowledged(form)) back(invoicePath(form), "Tick the box to confirm the void.", "error");
  const { error } = await supabase.rpc("void_quick_payment", { p_payment_id: str(form, "paymentId"), p_reason: str(form, "reason") });
  if (error) back(invoicePath(form), errorText(error), "error");
  done(invoicePath(form), "Payment voided.");
}
