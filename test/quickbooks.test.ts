import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, seal } from "@/lib/integrations/quickbooks/crypto";
import { QboError, toQboError } from "@/lib/integrations/quickbooks/errors";

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips a token", () => {
    const sealed = seal("refresh-token-value", key);
    expect(sealed).not.toContain("refresh-token-value");
    expect(open(sealed, key)).toBe("refresh-token-value");
  });

  it("never produces the same ciphertext twice", () => {
    expect(seal("same", key)).not.toBe(seal("same", key));
  });

  it("refuses the wrong key or a tampered value", () => {
    const sealed = seal("secret", key);
    expect(() => open(sealed, randomBytes(32))).toThrow();
    const [iv, tag, body] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => open([iv, tag, flipped.toString("base64url")].join("."), key)).toThrow();
  });
});

describe("toQboError", () => {
  it("sends the owner to reconnect when the refresh token is dead", () => {
    const err = toQboError({ error: "invalid_grant", error_description: "Token invalid", intuit_tid: "tid-1" });
    expect(err.kind).toBe("reconnect");
    expect(err.intuitTid).toBe("tid-1");
  });

  it("flags bad app credentials", () => {
    expect(toQboError({ error: "invalid_client" }).kind).toBe("bad_credentials");
  });

  it("maps API statuses", () => {
    expect(toQboError({ status: 401 }).kind).toBe("reconnect");
    expect(toQboError({ status: 403 }).kind).toBe("forbidden");
    expect(toQboError({ status: 429 }).kind).toBe("rate_limited");
    expect(toQboError({ status: 503 }).kind).toBe("unavailable");
  });

  it("surfaces QuickBooks Fault details", () => {
    const err = toQboError({
      status: 400,
      fault: { errors: [{ message: "Invalid Reference Id", detail: "Customer 99 not found" }] },
      intuitTid: "tid-2",
    });
    expect(err.kind).toBe("request");
    expect(err.message).toContain("Customer 99 not found");
    expect(err.toJSON()).toMatchObject({ error: "request", intuit_tid: "tid-2" });
  });

  it("reads the status intuit-oauth puts in error.code", () => {
    // Shapes thrown by makeApiCall (src/OAuthClient.js): new OAuthError(message, code, description, tid)
    expect(toQboError({ message: "HTTP Error", code: "401", intuitTid: "t" }).status).toBe(401);
    expect(toQboError({ message: "HTTP Error", code: "401" }).kind).toBe("reconnect");
    expect(toQboError({ message: "Rate limit exceeded", code: "RATE_LIMIT_EXCEEDED" }).kind).toBe("rate_limited");
    expect(toQboError({ message: "x", code: "INTERNAL_SERVER_ERROR" }).kind).toBe("unavailable");
    expect(toQboError({ message: "Connection reset by peer", code: "NETWORK_ERROR" }).kind).toBe("unavailable");
  });

  it("keeps Fault codes so callers can react to specific ones", () => {
    const err = toQboError({
      code: "6240",
      fault: { errors: [{ message: "Duplicate Name Exists Error", detail: "The name supplied already exists.", code: "6240" }] },
    });
    expect(err.kind).toBe("request");
    expect(err.faultCodes).toEqual(["6240"]);
  });

  it("does not mistake a 3-digit Fault code for an HTTP status", () => {
    const err = toQboError({ code: "610", fault: { errors: [{ message: "Object Not Found", code: "610" }] } });
    expect(err.kind).toBe("request");
    expect(err.faultCodes).toEqual(["610"]);
  });

  it("passes QboErrors through", () => {
    const original = new QboError("not_connected");
    expect(toQboError(original)).toBe(original);
  });
});
