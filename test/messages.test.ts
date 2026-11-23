import { describe, expect, it } from "vitest";
import type { StatementView } from "@/lib/billing/statement";
import {
  reminderEmail,
  requestApprovedEmail,
  requestApprovedSms,
  requestReceivedEmail,
  requestReceivedSms,
  statementEmail,
} from "@/lib/outbox/messages";

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

describe("dumpster request emails (Nov 23)", () => {
  const request = {
    name: "AKG Contractor LLC",
    contact: "Alex Kim",
    phone: "+16095550123",
    email: "alex@akg.example",
    date: "2026-11-24",
    address: "109 Center Ave, Phoenixville, PA 19460, USA",
    notes: "Driveway, first thing",
  };

  it("tells staff who, when, where and how to reach them, with the link to approve", () => {
    const { subject, text } = requestReceivedEmail(request, "https://app.example");
    expect(subject).toBe("New dumpster request: AKG Contractor LLC, Tue, Nov 24");
    expect(text).toContain("Address: 109 Center Ave, Phoenixville, PA 19460, USA");
    expect(text).toContain("Contact: Alex Kim");
    expect(text).toContain("Phone: (609) 555-0123");
    expect(text).toContain("Notes: Driveway, first thing");
    expect(text).toContain("https://app.example/office/requests");
    expect(text).toContain("Replying to this email goes to the customer.");
  });

  it("leaves out what the customer didn't give, and the contact line when it's the same name", () => {
    const { text } = requestReceivedEmail({ ...request, contact: "AKG Contractor LLC", email: null, notes: null }, "");
    expect(text).not.toContain("Contact:");
    expect(text).not.toContain("Email:");
    expect(text).not.toContain("Notes:");
    expect(text).not.toContain("Replying");
    expect(text).not.toContain("null");
  });

  it("writes to staff in Spanish when that is their language", () => {
    expect(requestReceivedEmail({ ...request, locale: "es" }, "").subject).toMatch(/^Nueva solicitud de contenedor/);
  });

  it("confirms the booking to the customer by first name, with a way to change it", () => {
    const { subject, text } = requestApprovedEmail(
      { name: "Alex Kim", date: "2026-11-24", address: "232 Hewitt St, Trenton, NJ 08611, USA", sizeYards: 20 },
      { name: "DropWise", phone: "+16095550100" },
    );
    expect(subject).toBe("Your 20-yard dumpster is booked for Tue, Nov 24");
    expect(text).toMatch(/^Hi Alex,/);
    expect(text).toContain("232 Hewitt St, Trenton, NJ 08611, USA");
    expect(text).toContain("reply to this email or call (609) 555-0100");
    expect(text).not.toContain("STOP");
  });

  it("still reads right with no size or phone", () => {
    const { subject, text } = requestApprovedEmail({ name: "", date: "2026-11-24", address: "X", sizeYards: null }, { name: "DropWise", phone: null });
    expect(subject).toBe("Your dumpster is booked for Tue, Nov 24");
    expect(text).toMatch(/^Hi,\n/);
    expect(text).toContain("Just reply to this email.");
    expect(text).not.toContain("null");
  });
});
