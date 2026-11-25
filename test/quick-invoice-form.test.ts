import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/app/office/invoices/actions", () => ({ saveQuickInvoice: vi.fn() }));
import { QuickInvoiceForm } from "@/app/office/invoices/_form";
import type { QuickInvoiceContext } from "@/lib/billing/quick-invoice";

// Synthetic records only.
const CONTEXT: QuickInvoiceContext = {
  brands: [
    { id: "b-dump", kind: "dumpster", name: "DropWise" },
    { id: "b-roof", kind: "roofing", name: "American Prime Construction" },
  ],
  items: [
    { id: "i-1", source: "dumpster_price", group: "Dumpster price list", description: "Mattress", unit: "each", unitCents: 5000 },
    { id: "i-2", source: "sub_price", group: "Example GC rates", description: '5" K-style gutter', unit: "ft", unitCents: 550 },
  ],
  billTo: [
    { value: "customer:c-1", group: "Customers", label: "Example Builders", name: "Example Builders", email: "ap@builders.example", phone: "", address: "", termsDays: 30 },
    { value: "lead:l-1", group: "Leads", label: "Pat Example · 1 Example Road", name: "Pat Example", email: "", phone: "+16095550100", address: "1 Example Road", termsDays: null },
  ],
};

describe("quick invoice form", () => {
  const html = renderToStaticMarkup(React.createElement(QuickInvoiceForm, { context: CONTEXT, today: "2026-11-25" }));

  it("offers Custom item first, then the stored price lists", () => {
    const item = html.slice(html.indexOf("<span>Item</span>"));
    const custom = item.indexOf(">Custom item<");
    expect(custom).toBeGreaterThan(-1);
    expect(custom).toBeLessThan(item.indexOf('label="Dumpster price list"'));
    expect(item).toContain("Mattress · $50.00 each");
    expect(item).toContain('label="Example GC rates"');
    expect(item).toContain("5&quot; K-style gutter · $5.50 a foot");
  });

  it("goes out as the roofing brand and is due in 15 days unless changed", () => {
    expect(html).toMatch(/<option value="b-roof" selected="">American Prime Construction<\/option>/);
    expect(html).toContain('value="2026-12-10"');
  });

  it("lets the bill-to be typed or filled from a customer, contractor or lead", () => {
    expect(html).toContain("Type it in below");
    expect(html).toContain('label="Customers"');
    expect(html).toContain('label="Leads"');
    expect(html).not.toContain('label="Contractors"');
  });

  it("doesn't nag before anything is typed", () => {
    expect(html).toContain("Add who it&#x27;s for and a line, then save it as a draft to preview.");
    expect(html).not.toContain("Enter who the invoice is for.");
  });

  it("only saves a draft; nothing is sent from the form", () => {
    const filled = renderToStaticMarkup(React.createElement(QuickInvoiceForm, {
      context: CONTEXT, today: "2026-11-25", invoiceId: "qi-1",
      initial: {
        brandId: "b-dump", fillFrom: "", name: "Pat Example", email: "", phone: "", address: "", dueOn: "2026-12-10", taxPct: "6.625", memo: "",
        lines: [
          { key: "a", source: "sub_price", itemId: "i-2", description: '5" K-style gutter', quantity: "120", unit: "ft", price: "6.00" },
          { key: "b", source: "custom", itemId: "", description: "Chimney repair", quantity: "1", unit: "", price: "450" },
        ],
      },
    }));
    expect(filled).toContain("Save draft and preview");
    expect(filled).toContain("Nothing goes to anyone until you issue it.");
    expect(filled).toContain('<option value="sub_price:i-2" selected="">');
    expect(filled).toContain("$1,170.00"); // subtotal
    expect(filled).toContain("$77.51"); // 6.625% tax
    expect(filled).toContain("$1,247.51");
    expect(filled).toContain('name="invoiceId" value="qi-1"');
  });
});
