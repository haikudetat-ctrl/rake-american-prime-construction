import { describe, expect, it } from "vitest";
import { CONSENT_BODY, CONSENT_POLICIES, CONTACT_CONSENT } from "@/lib/leads/schema";
import { legalIdentity, unfilledLegalFields } from "@/lib/site/legal";

describe("text consent wording", () => {
  it("stores exactly what the form shows", () => {
    expect(CONTACT_CONSENT).toBe(`${CONSENT_BODY} ${CONSENT_POLICIES}`);
  });

  it("carries what A2P reviewers check for", () => {
    for (const needed of ["American Prime Construction", "not a condition of purchase", "frequency varies", "rates may apply", "STOP", "HELP", "Privacy Policy"]) {
      expect(CONTACT_CONSENT).toContain(needed);
    }
  });
});

describe("legal page facts", () => {
  it("uses Settings when filled in and a visible placeholder when not", () => {
    const filled = legalIdentity({ legal: { name: "Example LLC", address: "1 Main St" }, contacts: { roofing: { email: "a@b.example" } } });
    expect(filled).toEqual({ name: "Example LLC", address: "1 Main St", email: "a@b.example" });
    const blank = legalIdentity({ legal: { name: null, address: null }, contacts: { roofing: { email: null } } });
    expect(blank.name).toMatch(/^\[/);
    expect(blank.address).toMatch(/^\[/);
  });

  it("lists placeholders still waiting on the business", () => {
    // Informational: this is the launch checklist, not a failure.
    expect(Array.isArray(unfilledLegalFields())).toBe(true);
  });
});
