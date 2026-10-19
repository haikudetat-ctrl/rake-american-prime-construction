import { describe, expect, it } from "vitest";
import { utcToZonedInput, zonedToUtc } from "@/lib/dates";
import { daysInStage, leadRequestSchema, needsAttention, officeLeadSchema, winRate } from "@/lib/leads/schema";
import { leadReceivedSms } from "@/lib/outbox/messages";

const base = { name: "Pat Homeowner", phone: "(609) 555-0100", address: "12 Ocean Ave, Ventnor", formToken: "t" };

describe("roofing request form", () => {
  it("normalizes the phone and defaults an unknown need", () => {
    const parsed = leadRequestSchema.parse({ ...base, need: "solar" });
    expect(parsed.phone).toBe("+16095550100");
    expect(parsed.need).toBe("other");
    expect(parsed.consent).toBeUndefined();
  });

  it("records consent only when the box is ticked", () => {
    expect(leadRequestSchema.parse({ ...base, consent: "on" }).consent).toBe("on");
  });

  it("rejects a filled honeypot and unknown fields", () => {
    expect(leadRequestSchema.safeParse({ ...base, website: "spam.example" }).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...base, admin: "1" }).success).toBe(false);
  });
});

describe("office lead entry", () => {
  it("needs a phone or an email", () => {
    expect(officeLeadSchema.safeParse({ name: "Walk-in" }).success).toBe(false);
    expect(officeLeadSchema.safeParse({ name: "Walk-in", email: "a@b.co" }).success).toBe(true);
    expect(officeLeadSchema.safeParse({ name: "Walk-in", phone: "609 555 0100", source: "bogus" }).data?.source).toBe("office");
  });
});

describe("pipeline helpers", () => {
  const now = new Date("2026-10-19T15:00:00Z");
  it("counts whole days in a stage", () => {
    expect(daysInStage("2026-10-18T14:00:00Z", now)).toBe(1);
    expect(daysInStage("2026-10-19T14:00:00Z", now)).toBe(0);
  });
  it("flags untouched new leads after a day and silent proposals after a week", () => {
    expect(needsAttention("new", "2026-10-18T14:00:00Z", now)).toBe(true);
    expect(needsAttention("new", "2026-10-19T10:00:00Z", now)).toBe(false);
    expect(needsAttention("proposal_sent", "2026-10-13T14:00:00Z", now)).toBe(false);
    expect(needsAttention("proposal_sent", "2026-10-11T14:00:00Z", now)).toBe(true);
    expect(needsAttention("appointment", "2026-09-01T14:00:00Z", now)).toBe(false);
  });
  it("computes win rate only once something has closed", () => {
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(1, 2)).toBe(33);
  });
});

describe("company time for appointments", () => {
  it("converts New York wall time to UTC across daylight saving", () => {
    expect(zonedToUtc("2026-10-21T14:30")).toBe("2026-10-21T18:30:00.000Z"); // EDT
    expect(zonedToUtc("2026-12-01T09:00")).toBe("2026-12-01T14:00:00.000Z"); // EST
    expect(utcToZonedInput("2026-10-21T18:30:00.000Z")).toBe("2026-10-21T14:30");
  });
});

describe("new lead text", () => {
  it("links to the lead", () => {
    expect(leadReceivedSms({ leadId: "L1", name: "Pat", need: "storm", address: "12 Ocean Ave" }, "https://app"))
      .toBe("New roofing lead: Pat (storm damage), 12 Ocean Ave. Open: https://app/office/leads/L1");
    expect(leadReceivedSms({ leadId: "L1", name: "Pat", need: "x", address: null, locale: "es" }, "https://app"))
      .toBe("Nuevo cliente de techo: Pat (techo). Ver: https://app/office/leads/L1");
  });
});
