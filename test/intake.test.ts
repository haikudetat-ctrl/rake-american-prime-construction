import { describe, expect, it } from "vitest";
import { failedFields, formFields, isTooFast, rentalRequestSchema } from "@/lib/intake/schema";
import { intakeErrorText } from "@/lib/intake/messages";
import { t } from "@/lib/i18n";
import { issueFormToken, readFormToken } from "@/lib/intake/token";

const valid = {
  contactName: "Pat Roofer",
  companyName: "Shore Roofing",
  phone: "(609) 555-0123",
  email: "billing@shore.example",
  placeId: "ChIJ12OceanAveVentnor",
  address: "12 Ocean Ave, Ventnor City, NJ, USA",
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

  it("books a size we don't run as \"not sure\"", () => {
    expect(rentalRequestSchema.parse({ ...valid, sizeYards: "30" }).sizeYards).toBeUndefined();
    expect(rentalRequestSchema.parse({ ...valid, sizeYards: "" }).sizeYards).toBeUndefined();
    expect(rentalRequestSchema.parse({ ...valid, sizeYards: "15" }).sizeYards).toBe(15);
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

describe("submitted form fields", () => {
  // What the dumpster form sent on its first submit before the Oct 21 fix:
  // React's hidden progressive-enhancement inputs, left in the page after hydration.
  function firstSubmit(): FormData {
    const form = new FormData();
    form.append("$ACTION_REF_1", "");
    form.append("$ACTION_1:0", '{"id":"6039f2be","bound":"$@1"}');
    form.append("$ACTION_1:1", '["$@2"]');
    form.append("$ACTION_KEY", "k123");
    for (const [key, value] of Object.entries(valid)) form.append(key, value);
    form.append("photos", new File([], ""));
    return form;
  }

  it("drops framework keys and files so the strict schema sees only form fields", () => {
    const fields = formFields(firstSubmit());
    expect(Object.keys(fields).some((k) => k.startsWith("$ACTION"))).toBe(false);
    expect(fields.photos).toBeUndefined();
    expect(rentalRequestSchema.safeParse(fields).success).toBe(true);
  });

  it("would have failed the first submit without the filter", () => {
    expect(rentalRequestSchema.safeParse(Object.fromEntries(firstSubmit())).success).toBe(false);
  });

  it("names only real fields as the ones to fix", () => {
    const parsed = rentalRequestSchema.safeParse({ ...valid, phone: "555", status: "x" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(failedFields(parsed.error.issues)).toEqual(["phone"]);
  });
});

describe("form error text", () => {
  it("says which fields to check", () => {
    expect(intakeErrorText({ error: "invalid", fields: ["phone", "zip"] })).toBe("Check mobile phone and ZIP, then send again.");
    expect(intakeErrorText({ error: "invalid", fields: ["town", "zip", "email"] })).toBe("Check town, ZIP and email, then send again.");
  });

  it("never points at a field that isn't there", () => {
    expect(intakeErrorText({ error: "invalid", fields: [] })).toMatch(/didn't go through/);
    expect(intakeErrorText({ error: "invalid" })).toMatch(/didn't go through/);
  });
});
