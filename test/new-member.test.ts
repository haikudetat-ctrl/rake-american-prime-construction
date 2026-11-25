import { describe, expect, it } from "vitest";
import { ADDABLE_ROLES, newMemberProblem, signsInByPhone } from "@/lib/office/new-member";

describe("adding a team member", () => {
  it("offers crew alongside driver, office and owner", () => {
    expect(ADDABLE_ROLES).toEqual(["driver", "crew", "office", "owner"]);
  });

  it("signs drivers and crew in by phone, office and owners by email", () => {
    expect(signsInByPhone("driver")).toBe(true);
    expect(signsInByPhone("crew")).toBe(true);
    expect(signsInByPhone("office")).toBe(false);
    expect(signsInByPhone("owner")).toBe(false);
  });

  it("accepts crew with a mobile and no email", () => {
    expect(newMemberProblem({ role: "crew", email: null, phone: "(609) 555-0123" })).toBeNull();
  });

  it("asks crew and drivers for a mobile", () => {
    expect(newMemberProblem({ role: "crew", email: null, phone: null })).toBe("Crew sign in by phone; add their mobile number.");
    expect(newMemberProblem({ role: "driver", email: "d@example.com", phone: null })).toBe(
      "Drivers sign in by phone; add their mobile number.",
    );
  });

  it("rejects a phone that isn't a US mobile", () => {
    expect(newMemberProblem({ role: "crew", email: null, phone: "12345" })).toBe("That phone number isn't a 10-digit US number.");
  });

  it("asks office and owners for an email", () => {
    expect(newMemberProblem({ role: "office", email: null, phone: "6095550123" })).toBe(
      "Office and owners sign in by email; add their email.",
    );
    expect(newMemberProblem({ role: "owner", email: "o@example.com", phone: null })).toBeNull();
  });

  it("refuses an unknown role", () => {
    expect(newMemberProblem({ role: "admin", email: "a@example.com", phone: null })).toBe("Pick a role.");
  });
});
