import { describe, expect, it } from "vitest";
import { normalizeCode, normalizeEmail, passwordProblem, signInCodeEmail, signInProblem } from "@/lib/sign-in";

describe("signInProblem", () => {
  it("stays quiet when the address has no account", () => {
    expect(signInProblem({ status: 422, code: "otp_disabled" })).toBeNull();
    expect(signInProblem({ status: 400, code: "signup_disabled" })).toBeNull();
    expect(signInProblem(null)).toBeNull();
  });

  it("reports rate limits", () => {
    expect(signInProblem({ status: 429 })).toBe("rate");
    expect(signInProblem({ status: 400, code: "over_email_send_rate_limit" })).toBe("rate");
  });

  it("reports failures that are ours, like a bad API key", () => {
    expect(signInProblem({ status: 401 })).toBe("system");
    expect(signInProblem({ status: 500 })).toBe("system");
    expect(signInProblem({})).toBe("system");
  });
});

describe("normalizeCode", () => {
  it("keeps only the digits of a pasted code", () => {
    expect(normalizeCode(" 123 456 ")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode(null)).toBe("");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Andrey@APConstructionNJ.com ")).toBe("andrey@apconstructionnj.com");
  });
});

describe("signInCodeEmail", () => {
  const email = signInCodeEmail({ company: "American Prime Construction", code: "482913" });

  it("puts the code in the subject, for the phone notification", () => {
    expect(email.subject).toBe("482913 is your American Prime Construction sign-in code");
  });

  it("has the code and no link", () => {
    expect(email.text).toContain("482913");
    expect(email.text).not.toMatch(/https?:\/\//);
  });
});

describe("passwordProblem", () => {
  it("is quiet on success", () => {
    expect(passwordProblem(null)).toBeNull();
  });

  it("explains a reused or weak password", () => {
    expect(passwordProblem({ code: "same_password" })).toMatch(/already your password/);
    expect(passwordProblem({ code: "weak_password", message: "Password should contain a symbol" })).toBe(
      "Password should contain a symbol",
    );
  });

  it("asks for a fresh sign-in when Supabase wants reauthentication", () => {
    expect(passwordProblem({ code: "reauthentication_needed" })).toMatch(/sign in again/);
  });

  it("reports anything else as ours", () => {
    expect(passwordProblem({ status: 500 })).toMatch(/2Stack support/);
  });
});
