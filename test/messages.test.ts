import { describe, expect, it } from "vitest";
import type { StatementView } from "@/lib/billing/statement";
import { reminderEmail, requestApprovedSms, requestReceivedSms, statementEmail } from "@/lib/outbox/messages";

const statement: StatementView = {
  id: "s1",
  number: 1002,
  issuedOn: "2026-10-19",
  dueOn: "2026-11-03",
  status: "open",
  voidReason: null,
  sentAt: null,
  totalCents: 116500,
  paidCents: 0,
  balanceCents: 116500,
  brand: { name: "American Prime Construction", phone: "+16095550100", email: null, address: "1 Main St, Trenton NJ" },
  customer: { name: "Shore Roofing", billingEmail: "billing@shore.example" },
  invoices: [
    { number: 1002, rentalId: null, quickbooks: { synced: false, error: null }, address: "12 Ocean Ave", dates: "", totalCents: 56000, lines: [] },
    { number: 1003, rentalId: null, quickbooks: { synced: false, error: null }, address: "9 Bay Rd", dates: "", totalCents: 60500, lines: [] },
  ],
  payments: [],
};

describe("outbox messages", () => {
  it("texts staff about a new request with a link to approve", () => {
    const text = requestReceivedSms({ name: "Shore Roofing", date: "2026-10-20", address: "12 Ocean Ave" }, "https://app.example");
    expect(text).toContain("Shore Roofing");
    expect(text).toContain("https://app.example/office/requests");
  });

  it("texts staff in Spanish when that is their language", () => {
    expect(requestReceivedSms({ name: "X", date: "2026-10-20", address: "Y", locale: "es" }, "")).toMatch(/^Nueva solicitud/);
  });

  it("confirms the booking to the customer with opt-out language", () => {
    const text = requestApprovedSms({ date: "2026-10-20", address: "12 Ocean Ave" }, { name: "American Prime", phone: "+16095550100" });
    expect(text).toContain("(609) 555-0100");
    expect(text).toContain("Reply STOP");
    expect(text.length).toBeLessThan(320);
  });

  it("lists every job and the balance on the statement email", () => {
    const { subject, text } = statementEmail(statement);
    expect(subject).toContain("$1,165.00");
    expect(text).toContain("#1002  12 Ocean Ave  $560.00");
    expect(text).toContain("#1003  9 Bay Rd  $605.00");
    expect(text).toContain("1 Main St, Trenton NJ");
  });

  it("says how late a reminder is", () => {
    expect(reminderEmail(statement, 5).text).toContain("5 days past due");
  });
});
