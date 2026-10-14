import { describe, expect, it } from "vitest";
import { addDays, companyToday, weekStart } from "@/lib/dates";
import { formatPhone, toE164 } from "@/lib/phone";

describe("dates", () => {
  it("uses the company timezone for today", () => {
    // 02:00 UTC on the 15th is still the 14th in New Jersey.
    expect(companyToday(new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-14")).toBe("2026-10-12"); // Wednesday
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("phone", () => {
  it("normalizes common US formats", () => {
    expect(toE164("(609) 555-0123")).toBe("+16095550123");
    expect(toE164("1-609-555-0123")).toBe("+16095550123");
    expect(toE164("+1 609 555 0123")).toBe("+16095550123");
  });

  it("rejects numbers that cannot be dialed", () => {
    expect(toE164("555-0123")).toBeNull();
    expect(toE164("(109) 555-0123")).toBeNull();
    expect(toE164("")).toBeNull();
  });

  it("formats for display", () => {
    expect(formatPhone("+16095550123")).toBe("(609) 555-0123");
  });
});
