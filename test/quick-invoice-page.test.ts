import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const fixture = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, rows: [] as unknown[], role: "office" }));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ role: fixture.role, name: "Example" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/office/invoices/actions", () => ({
  issueQuickInvoice: vi.fn(), recordQuickPayment: vi.fn(), sendQuickInvoice: vi.fn(), voidQuickInvoice: vi.fn(), voidQuickPayment: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        maybeSingle: async () => ({ data: fixture.row, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: fixture.rows, error: null }).then(resolve),
      };
      for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));
import QuickInvoicePage from "@/app/office/invoices/[id]/page";
import QuickInvoicesPage from "@/app/office/invoices/page";

// Synthetic records only.
const ROW = {
  id: "qi-1", number: 1028, status: "draft", issued_on: null, due_on: "2026-12-10", created_at: "2026-11-25T15:00:00Z",
  memo: null, tax_pct: "0", subtotal_cents: 45000, tax_cents: 0, total_cents: 45000, void_reason: null, sent_at: null, sent_to: null,
  email_queued_to: null, email_queued_for: null, bill_to_name: "Pat Example", bill_to_email: "pat@example.com", bill_to_phone: null, bill_to_address: null,
  customer_id: null, contractor_id: null, lead_id: null,
  brands: { id: "b", kind: "dumpster", display_name: "DropWise", phone: null, email: null, address: null },
  quick_invoice_lines: [{ position: 1, description: "Chimney repair", quantity: "1.00", unit: null, unit_cents: 45000, amount_cents: 45000, source: "custom", source_item_id: null }],
  quick_invoice_payments: [],
};
const props = () => ({ params: Promise.resolve({ id: "qi-1" }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T16:00:00Z"));
  fixture.role = "office";
  fixture.rows = [];
});

describe("quick invoice page", () => {
  it("shows a draft with its preview, edit and issue, emailing off unless ticked", async () => {
    fixture.row = ROW;
    const html = renderToStaticMarkup(await QuickInvoicePage(props() as never));
    expect(html).toContain("Draft invoice #1028");
    expect(html).toContain('href="/office/invoices/qi-1/pdf"');
    expect(html).toContain("Preview PDF");
    expect(html).toContain('href="/office/invoices/qi-1/edit"');
    expect(html).toContain("Issue invoice");
    expect(html).toContain("goes out as DropWise");
    expect(html).toContain("A draft. Nothing has been sent.");
    expect(html).toContain("Discard draft");
    expect(html).not.toContain("Record payment");
  });

  it("shows an issued invoice's email as waiting, not sent, during the hold", async () => {
    fixture.role = "owner";
    fixture.row = { ...ROW, status: "open", issued_on: "2026-11-25", email_queued_to: "pat@example.com", email_queued_for: "2026-11-25T16:15:00Z" };
    const html = renderToStaticMarkup(await QuickInvoicePage(props() as never));
    expect(html).toContain("Invoice #1028");
    expect(html).toContain("Email to pat@example.com goes out after");
    expect(html).toContain("Record payment");
    expect(html).toContain("Void invoice");
    expect(html).not.toContain("Issue invoice");
  });

  it("hides voiding an issued invoice from the office", async () => {
    fixture.row = { ...ROW, status: "open", issued_on: "2026-11-25" };
    const html = renderToStaticMarkup(await QuickInvoicePage(props() as never));
    expect(html).not.toContain("Void invoice");
  });
});

describe("quick invoices list", () => {
  it("adds up what's owed and flags what's overdue", async () => {
    fixture.rows = [
      { ...ROW, id: "a", status: "open", due_on: "2026-11-20", quick_invoice_payments: [{ amount_cents: 5000, voided_at: null }] },
      { ...ROW, id: "b", number: 1029, status: "draft" },
    ];
    const html = renderToStaticMarkup(await QuickInvoicesPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    expect(html).toContain("New quick invoice");
    expect(html).toContain("$400.00 owed on 1 invoice, $400.00 of it overdue.");
    expect(html).toContain("Overdue");
    expect(html).toContain("Drafts");
  });
});
