import { describe, expect, it } from "vitest";
import { shapeStatement } from "@/lib/billing/statement";

const row = {
  id: "s1",
  number: 1002,
  issued_on: "2026-10-19",
  due_on: "2026-11-03",
  status: "open",
  sent_at: null,
  total_cents: 116500,
  customers: { name: "Shore Roofing", billing_email: "billing@shore.example" },
  payments: [{ amount_cents: 50000, method: "check", reference: "1234", received_on: "2026-10-20" }],
  invoices: [
    {
      number: 1003,
      total_cents: 60500,
      invoice_lines: [
        { kind: "tonnage", description: "Disposal: 2.00 tons", amount_cents: 28000 },
        { kind: "delivery", description: "Dumpster delivery and pickup", amount_cents: 25000 },
        { kind: "extended_days", description: "Extended rental: 3 days past 7", amount_cents: 7500 },
      ],
      rentals: [{ dropped_at: "2026-10-05T14:00:00Z", picked_up_at: "2026-10-15T14:00:00Z", sites: { address: "9 Bay Rd" }, brands: null }],
    },
    {
      number: 1002,
      total_cents: 56000,
      invoice_lines: [{ kind: "delivery", description: "Dumpster delivery and pickup", amount_cents: 35000 }],
      rentals: {
        dropped_at: "2026-10-05T14:00:00Z",
        picked_up_at: null,
        sites: [{ address: "12 Ocean Ave" }],
        brands: { display_name: "Prime Dumpsters", phone: "+16095550100", email: null, address: null },
      },
    },
  ],
};

describe("shapeStatement", () => {
  const view = shapeStatement(row);

  it("orders invoices by number and lines delivery → extended → tonnage", () => {
    expect(view.invoices.map((i) => i.number)).toEqual([1002, 1003]);
    expect(view.invoices[1].lines.map((l) => l.amountCents)).toEqual([25000, 7500, 28000]);
  });

  it("computes paid and balance", () => {
    expect(view.paidCents).toBe(50000);
    expect(view.balanceCents).toBe(66500);
  });

  it("reads one-to-one embeds whether Supabase returns objects or arrays", () => {
    expect(view.invoices[0].address).toBe("12 Ocean Ave");
    expect(view.invoices[1].address).toBe("9 Bay Rd");
  });

  it("takes the brand from the rentals, defaulting to the company name", () => {
    expect(view.brand.name).toBe("Prime Dumpsters");
    expect(shapeStatement({ ...row, invoices: [row.invoices[0]] }).brand.name).toBe("American Prime Construction");
  });
});
