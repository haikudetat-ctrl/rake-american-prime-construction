import { describe, expect, it } from "vitest";
import type { StatementView } from "@/lib/billing/statement";
import { renderStatementPdf } from "@/lib/pdf/render";

describe("statement PDF", () => {
  it("renders a real PDF", async () => {
    const statement: StatementView = {
      id: "s1",
      number: 1002,
      issuedOn: "2026-10-19",
      dueOn: "2026-11-03",
      status: "open",
      sentAt: null,
      totalCents: 56000,
      paidCents: 0,
      balanceCents: 56000,
      brand: { name: "American Prime Construction", phone: "+16095550100", email: null, address: null },
      customer: { name: "Shore Roofing", billingEmail: "billing@shore.example" },
      invoices: [
        {
          number: 1002,
          address: "12 Ocean Ave, Ventnor City, NJ",
          dates: "Mon, Oct 5 – Thu, Oct 15",
          totalCents: 56000,
          lines: [
            { description: "Dumpster delivery and pickup", amountCents: 35000 },
            { description: "Disposal: 1.50 tons, ticket T-100", amountCents: 21000 },
          ],
        },
      ],
      payments: [],
    };
    const pdf = await renderStatementPdf(statement);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 20_000);
});
