import { describe, expect, it } from "vitest";
import { formatCents, parseDollarsToCents } from "@/lib/money";

describe("money", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(35000)).toBe("$350.00");
    expect(formatCents(116500)).toBe("$1,165.00");
    expect(formatCents(null)).toBe("$0.00");
  });

  it("parses dollar input without floating-point drift", () => {
    expect(parseDollarsToCents("350")).toBe(35000);
    expect(parseDollarsToCents("$1,234.56")).toBe(123456);
    expect(parseDollarsToCents("210.1")).toBe(21010);
    expect(parseDollarsToCents("0.29")).toBe(29);
  });

  it("rejects anything that is not an amount", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
});
