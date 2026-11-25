import { describe, expect, it } from "vitest";
import {
  defaultDueDate, emailWaiting, invoiceTotals, lineAmount, parsePrice, parseQuantity, parseTaxPct, quantityText, quickState,
  shapeQuickInvoice, toDraft, toPayload, type DraftInvoice, type QuickInvoiceView,
} from "@/lib/billing/quick-invoice";
import { formatCents } from "@/lib/money";
import { quickInvoiceEmail } from "@/lib/outbox/messages";
import { billingExceptions } from "@/lib/office/today";
import { renderQuickInvoicePdf } from "@/lib/pdf/render";

// Synthetic records only.
const BRAND = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const GC = "33333333-3333-4333-8333-333333333333";

const draft = (change: Partial<DraftInvoice> = {}): DraftInvoice => ({
  brandId: BRAND, fillFrom: "", name: "Pat Example", email: "", phone: "", address: "", dueOn: "2026-12-10", taxPct: "", memo: "",
  lines: [{ key: "a", source: "custom", itemId: "", description: "Chimney repair", quantity: "1", unit: "", price: "450" }],
  ...change,
});

const ROW = {
  id: "qi-1", number: 1028, status: "open", issued_on: "2026-11-25", due_on: "2026-12-10", created_at: "2026-11-25T15:00:00Z",
  memo: "Work at 1 Example Road", tax_pct: "6.625", subtotal_cents: 112000, tax_cents: 7420, total_cents: 119420,
  void_reason: null, sent_at: null, sent_to: null, email_queued_to: null, email_queued_for: null,
  bill_to_name: "Pat Example", bill_to_email: "pat@example.com", bill_to_phone: "+16095550100", bill_to_address: "1 Example Road",
  customer_id: null, contractor_id: GC, lead_id: null,
  brands: { id: BRAND, kind: "roofing", display_name: "American Prime Construction", phone: "+16095550199", email: "office@example.com", address: null },
  quick_invoice_lines: [
    { position: 2, description: '5" K-style gutter', quantity: "120.00", unit: "ft", unit_cents: 600, amount_cents: 72000, source: "sub_price", source_item_id: ITEM },
    { position: 1, description: "Chimney repair", quantity: "1.00", unit: null, unit_cents: 45000, amount_cents: 45000, source: "custom", source_item_id: null },
    { position: 3, description: "Returning customer credit", quantity: "1.00", unit: null, unit_cents: -5000, amount_cents: -5000, source: "custom", source_item_id: null },
  ],
  quick_invoice_payments: [
    { id: "p1", amount_cents: 19420, method: "check", reference: "1001", received_on: "2026-11-26", voided_at: null },
    { id: "p2", amount_cents: 50000, method: "ach", reference: null, received_on: "2026-11-26", voided_at: "2026-11-27T12:00:00Z" },
  ],
};

describe("quick invoice math", () => {
  it("rounds each line to the cent the way the database does", () => {
    expect(lineAmount(1.5, 33333)).toBe(50000);
    expect(lineAmount(120, 550)).toBe(66000);
    expect(lineAmount(1, -5000)).toBe(-5000);
    expect(lineAmount(0.5, -101)).toBe(-51);
  });

  it("taxes the subtotal and adds it up", () => {
    expect(invoiceTotals([{ quantity: 1, unitCents: 45000 }, { quantity: 120, unitCents: 600 }, { quantity: 2, unitCents: 5000 }, { quantity: 1, unitCents: -5000 }], 6.625))
      .toEqual({ subtotalCents: 122000, taxCents: 8083, totalCents: 130083 });
    expect(invoiceTotals([{ quantity: 1, unitCents: 45000 }], 0)).toEqual({ subtotalCents: 45000, taxCents: 0, totalCents: 45000 });
  });

  it("reads quantities, prices and tax the way people type them", () => {
    expect(parseQuantity("120")).toBe(120);
    expect(parseQuantity("1.5")).toBe(1.5);
    expect(parseQuantity("1,200")).toBe(1200);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1.234")).toBeNull();
    expect(parsePrice("450")).toBe(45000);
    expect(parsePrice("$1,250.00")).toBe(125000);
    expect(parsePrice("-50")).toBe(-5000);
    expect(parsePrice("-$50")).toBe(-5000);
    expect(parsePrice("$-50")).toBe(-5000);
    expect(parsePrice("--50")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("200000")).toBeNull();
    expect(parseTaxPct("")).toBe(0);
    expect(parseTaxPct("6.625%")).toBe(6.625);
    expect(parseTaxPct("21")).toBeNull();
  });

  it("is due in 15 days unless the customer or contractor has their own terms", () => {
    expect(defaultDueDate("2026-11-25")).toBe("2026-12-10");
    expect(defaultDueDate("2026-11-25", 30)).toBe("2026-12-25");
    expect(defaultDueDate("2026-11-25", 0)).toBe("2026-11-25");
  });
});

describe("quick invoice form", () => {
  it("sends the database a clean payload, with picked items remembered", () => {
    const result = toPayload(draft({
      fillFrom: `contractor:${GC}`, email: " PAT@Example.com ", taxPct: "6.625", memo: " ",
      lines: [
        { key: "a", source: "custom", itemId: "", description: " Chimney repair ", quantity: "1", unit: "", price: "450" },
        { key: "b", source: "sub_price", itemId: ITEM, description: '5" K-style gutter', quantity: "120", unit: "ft", price: "6.00" },
        { key: "c", source: "custom", itemId: "", description: "", quantity: "1", unit: "", price: "" },
      ],
    }));
    expect(result).toEqual({
      ok: true,
      payload: {
        brand_id: BRAND,
        bill_to: { name: "Pat Example", email: "pat@example.com", phone: null, address: null },
        customer_id: null, contractor_id: GC, lead_id: null,
        due_on: "2026-12-10", memo: null, tax_pct: 6.625,
        lines: [
          { description: "Chimney repair", quantity: 1, unit: null, unit_cents: 45000, source: "custom", source_item_id: null },
          { description: '5" K-style gutter', quantity: 120, unit: "ft", unit_cents: 600, source: "sub_price", source_item_id: ITEM },
        ],
      },
    });
  });

  it("names the first thing to fix", () => {
    expect(toPayload(draft({ name: " " }))).toMatchObject({ ok: false, error: "Enter who the invoice is for." });
    expect(toPayload(draft({ email: "pat@" }))).toMatchObject({ ok: false, error: "That email doesn't look right." });
    expect(toPayload(draft({ lines: [] }))).toMatchObject({ ok: false, error: "Add at least one line." });
    expect(toPayload(draft({ lines: [{ key: "a", source: "custom", itemId: "", description: "Repair", quantity: "0", unit: "", price: "10" }] })))
      .toMatchObject({ ok: false, error: "Line 1: enter a quantity, like 1 or 120.", line: 1 });
    expect(toPayload(draft({ lines: [{ key: "a", source: "custom", itemId: "", description: "Credit", quantity: "1", unit: "", price: "-10" }] })))
      .toMatchObject({ ok: false, error: "Credits can't take the invoice below zero." });
    expect(toPayload(draft({ taxPct: "25" }))).toMatchObject({ ok: false });
  });

  it("puts a saved draft back in the form as it was typed", () => {
    const invoice = shapeQuickInvoice({ ...ROW, status: "draft" });
    const back = toDraft(invoice);
    expect(back.fillFrom).toBe(`contractor:${GC}`);
    expect(back.lines.map((l) => [l.description, l.quantity, l.price, l.source])).toEqual([
      ["Chimney repair", "1", "450.00", "custom"],
      ['5" K-style gutter', "120", "6.00", "sub_price"],
      ["Returning customer credit", "1", "-50.00", "custom"],
    ]);
    expect(toPayload(back).ok).toBe(true);
  });
});

describe("quick invoice record", () => {
  const invoice: QuickInvoiceView = shapeQuickInvoice(ROW);

  it("orders lines, ignores voided payments and works out the balance", () => {
    expect(invoice.lines.map((l) => l.description)).toEqual(["Chimney repair", '5" K-style gutter', "Returning customer credit"]);
    expect(invoice.paidCents).toBe(19420);
    expect(invoice.balanceCents).toBe(100000);
    expect(invoice.taxPct).toBe(6.625);
    expect(quantityText(invoice.lines[1], formatCents)).toBe("120 ft × $6.00");
    expect(quantityText(invoice.lines[0], formatCents)).toBe("$450.00");
  });

  it("reads overdue only when it's open and past due", () => {
    expect(quickState({ status: "open", dueOn: "2026-11-24" }, "2026-11-25")).toEqual({ label: "Overdue", tone: "danger" });
    expect(quickState({ status: "open", dueOn: "2026-11-25" }, "2026-11-25").label).toBe("Open");
    expect(quickState({ status: "draft", dueOn: "2026-11-01" }, "2026-11-25").label).toBe("Draft");
    expect(quickState({ status: "paid", dueOn: "2026-11-01" }, "2026-11-25").label).toBe("Paid");
  });

  it("treats a queued email as waiting until a send is recorded after it", () => {
    const queued = { status: "open" as const, emailQueuedFor: "2026-11-25T15:15:00Z" };
    expect(emailWaiting({ ...queued, sentAt: null })).toBe(true);
    expect(emailWaiting({ ...queued, sentAt: "2026-11-25T15:16:00Z" })).toBe(false);
    expect(emailWaiting({ ...queued, sentAt: "2026-11-20T15:16:00Z" })).toBe(true);
    expect(emailWaiting({ ...queued, status: "void", sentAt: null })).toBe(false);
    expect(emailWaiting({ status: "open", emailQueuedFor: null, sentAt: null })).toBe(false);
  });

  it("emails the balance with the brand's name", () => {
    const email = quickInvoiceEmail(invoice);
    expect(email.subject).toBe("Invoice #1028 from American Prime Construction: $1,000.00 due Thu, Dec 10");
    expect(email.text).toContain("Hi Pat Example,");
    expect(email.text).toContain("Work at 1 Example Road");
    expect(email.text).toContain("Sales tax  $74.20");
    expect(email.text).toContain("Balance due: $1,000.00");
  });

  it("renders a real PDF, draft and issued", async () => {
    for (const status of ["draft", "open"] as const) {
      const pdf = await renderQuickInvoicePdf({ ...invoice, status }, "2026-11-25");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1000);
    }
  }, 20_000);
});

describe("Billing to fix", () => {
  const ok = <T,>(data: T[]) => ({ data, error: null });
  const quick = (q: Record<string, unknown>) => ({
    id: "q", number: 1030, status: "open", bill_to_name: "Pat Example", due_on: "2026-11-30", created_at: "2026-11-25T15:00:00Z", total_cents: 50000,
    quick_invoice_payments: [], ...q,
  });

  it("lists a quick invoice past due and a draft left from an earlier day", () => {
    const q = billingExceptions("2026-11-25", {
      tickets: ok([]), unsent: ok([]), pastDue: ok([]),
      quick: ok([
        quick({ id: "due", due_on: "2026-11-20", quick_invoice_payments: [{ amount_cents: 10000, voided_at: null }] }),
        quick({ id: "stale", status: "draft", created_at: "2026-11-23T15:00:00Z" }),
        quick({ id: "fresh", status: "draft", created_at: "2026-11-25T15:00:00Z" }),
        quick({ id: "current" }),
      ]),
    });
    expect(q.count).toBe(2);
    expect(q.items.map((i) => i.href)).toEqual(["/office/invoices/due", "/office/invoices/stale"]);
    expect(q.items[0].detail).toBe("$400.00 was due Fri, Nov 20 · 5 days past due");
    expect(q.items[1].action).toBe("Issue or discard");
  });

  it("is unknown, not empty, when quick invoices fail to load", () => {
    const q = billingExceptions("2026-11-25", { tickets: ok([]), unsent: ok([]), pastDue: ok([]), quick: { data: null, error: { message: "down" } } });
    expect(q.count).toBeNull();
  });
});
