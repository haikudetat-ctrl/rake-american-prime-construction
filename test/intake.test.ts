import { describe, expect, it } from "vitest";
import { isTooFast, rentalRequestSchema } from "@/lib/intake/schema";
import { t } from "@/lib/i18n";
import { issueFormToken, readFormToken } from "@/lib/intake/token";

const valid = {
  contactName: "Pat Roofer",
  companyName: "Shore Roofing",
  phone: "(609) 555-0123",
  email: "billing@shore.example",
  address: "12 Ocean Ave, Ventnor City, NJ",
  requestedDate: "2026-10-20",
  sizeYards: "20",
  notes: "",
  website: "",
  formToken: "1700000000000.sig",
};

describe("rental request schema", () => {
  it("accepts a normal request and normalizes it", () => {
    const parsed = rentalRequestSchema.parse(valid);
    expect(parsed.phone).toBe("+16095550123");
    expect(parsed.sizeYards).toBe(20);
    expect(parsed.notes).toBeUndefined();
  });

  it("allows email to be left blank", () => {
    expect(rentalRequestSchema.parse({ ...valid, email: "" }).email).toBeUndefined();
  });

  it("rejects a bad phone or email", () => {
    expect(rentalRequestSchema.safeParse({ ...valid, phone: "555" }).success).toBe(false);
    expect(rentalRequestSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });

  it("rejects a filled honeypot", () => {
    expect(rentalRequestSchema.safeParse({ ...valid, website: "spam.example" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(rentalRequestSchema.safeParse({ ...valid, status: "approved" }).success).toBe(false);
  });

  it("flags forms submitted faster than a person can type", () => {
    expect(isTooFast(1000, 2000)).toBe(true);
    expect(isTooFast(1000, 60_000)).toBe(false);
  });
});

describe("i18n", () => {
  it("has Spanish for driver screens", () => {
    expect(t("es", "driver.kind.drop")).toBe("Entregar");
    expect(t("en", "driver.kind.drop")).toBe("Drop");
  });
});

describe("form token", () => {
  it("round-trips the render time", () => {
    expect(readFormToken(issueFormToken("secret", 1234), "secret")).toBe(1234);
  });

  it("rejects a forged or re-timed token", () => {
    const token = issueFormToken("secret", 1234);
    expect(readFormToken(token, "other-secret")).toBeNull();
    expect(readFormToken(token.replace("1234", "1000"), "secret")).toBeNull();
    expect(readFormToken("garbage", "secret")).toBeNull();
  });
});
