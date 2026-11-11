import { describe, expect, it } from "vitest";
import { subStatementEmail } from "@/lib/outbox/messages";
import type { SubStatementView } from "@/lib/subcontract/statement";
import { periodText } from "@/lib/subcontract/view";

const statement: SubStatementView = {
  id: "s1", number: 1007, issuedOn: "2026-11-16", dueOn: "2026-11-30", periodStart: "2026-11-09", periodEnd: "2026-11-13",
  status: "open", voidReason: null, sentAt: null, totalCents: 410000, paidCents: 0, balanceCents: 410000,
  brand: { name: "Example Roofing", phone: "+16095550100", email: null, address: "1 Example Road" },
  contractor: { id: "c1", name: "Example GC", billingEmail: "ap@example.com" },
  invoices: [
    { id: "i1", number: 1051, jobId: "j1", address: "1 Monday Road", workDate: "2026-11-09", scope: "20 squares · 6/12 pitch", totalCents: 240000, paidCents: 0, lines: [] },
    { id: "i2", number: 1052, jobId: "j2", address: "2 Friday Road", workDate: "2026-11-13", scope: "Gutters and extras", totalCents: 170000, paidCents: 0, lines: [] },
  ],
  payments: [],
};

describe("weekly statement email", () => {
  it("lists every job and asks for one check", () => {
    const email = subStatementEmail(statement);
    expect(email.subject).toBe("Statement #1007 from Example Roofing: 2 jobs, $4,100.00 due Mon, Nov 30");
    expect(email.text).toContain("for you Mon, Nov 9 to Fri, Nov 13");
    expect(email.text).toContain("#1051  Mon, Nov 9  1 Monday Road  $2,400.00");
    expect(email.text).toContain("#1052  Fri, Nov 13  2 Friday Road  $1,700.00");
    expect(email.text).toContain("One check for the balance to Example Roofing (1 Example Road)");
    expect(email.text).toContain("Please include statement #1007.");
  });

  it("names a single day once", () => {
    expect(periodText("2026-11-09", "2026-11-09")).toBe("Mon, Nov 9");
  });
});
