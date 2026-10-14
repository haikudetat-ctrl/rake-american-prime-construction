import { describe, expect, it } from "vitest";
import { signInProblem } from "@/lib/sign-in";

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
