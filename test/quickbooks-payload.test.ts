import { describe, expect, it } from "vitest";
import {
  bodyHash,
  displayName,
  invoiceBody,
  MappingMissing,
  paidCents,
  quoteQuery,
  type ItemMapping,
  type RakeInvoice,
} from "@/lib/integrations/quickbooks/payload";

const items: ItemMapping = { delivery: "1", extended_days: "2", tonnage: "3", adjustment: "4" };

const invoice: RakeInvoice = {
  number: 1042,
  issuedOn: "2026-10-19",
  dueOn: "2026-11-03",
  statementNumber: 2001,
  siteAddress: "12 Ocean Ave",
  lines: [
    { kind: "delivery", description: "20 yd dumpster", quantity: 1, unitCents: 35000, amountCents: 35000 },
    { kind: "tonnage", description: "1.37 tons", quantity: 1.37, unitCents: 7300, amountCents: 10001 },
    { kind: "adjustment", description: "Loyalty credit", quantity: 1, unitCents: null, amountCents: -5000 },
  ],
};

describe("QuickBooks invoice body", () => {
  it("maps header fields and lines to the chosen items", () => {
    const body = invoiceBody(invoice, "58", items);
    expect(body).toMatchObject({
      CustomerRef: { value: "58" },
      DocNumber: "R-1042",
      TxnDate: "2026-10-19",
      DueDate: "2026-11-03",
      PrivateNote: "Rake invoice 1042, statement 2001 · 12 Ocean Ave",
    });
    expect(body.Line[0]).toEqual({
      DetailType: "SalesItemLineDetail",
      Amount: 350,
      Description: "20 yd dumpster",
      SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: 350 },
    });
    expect(body.Line[2].Amount).toBe(-50);
    expect(body.Line[2].SalesItemLineDetail).toEqual({ ItemRef: { value: "4" } });
  });

  it("leaves out Qty and UnitPrice when they don't multiply out to the amount", () => {
    // 1.37 × $73.00 = $100.01 exactly; 1.37 × $73.01 would not be.
    expect(invoiceBody(invoice, "58", items).Line[1].SalesItemLineDetail).toEqual({
      ItemRef: { value: "3" }, Qty: 1.37, UnitPrice: 73,
    });
    const off = { ...invoice, lines: [{ ...invoice.lines[1], unitCents: 7301 }] };
    expect(invoiceBody(off, "58", items).Line[0].SalesItemLineDetail).toEqual({ ItemRef: { value: "3" } });
  });

  it("refuses to build when a line kind has no item chosen", () => {
    expect(() => invoiceBody(invoice, "58", { ...items, tonnage: null })).toThrow(MappingMissing);
    expect(() => invoiceBody(invoice, "58", { ...items, extended_days: null })).not.toThrow();
  });

  it("hashes identical bodies the same and changed ones differently", () => {
    const a = bodyHash(invoiceBody(invoice, "58", items));
    expect(bodyHash(invoiceBody(invoice, "58", items))).toBe(a);
    expect(bodyHash(invoiceBody({ ...invoice, dueOn: "2026-11-04" }, "58", items))).not.toBe(a);
  });
});

describe("QuickBooks helpers", () => {
  it("quotes query values", () => {
    expect(quoteQuery("O'Brien Roofing")).toBe("'O\\'Brien Roofing'");
    expect(quoteQuery("a\\b")).toBe("'a\\\\b'");
  });

  it("reads paid amount from total minus balance", () => {
    expect(paidCents({ TotalAmt: 450, Balance: 250.5 })).toBe(19950);
    expect(paidCents({ TotalAmt: 450, Balance: 450 })).toBe(0);
    expect(paidCents({})).toBe(0);
  });

  it("cleans display names", () => {
    expect(displayName("  Shore:Roofing\tLLC ")).toBe("Shore Roofing LLC");
  });
});
