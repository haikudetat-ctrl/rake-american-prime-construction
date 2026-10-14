import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signed "this form was rendered at T" stamp. The time check on submit
 * (too fast = bot) only works if the submitter cannot pick T, so it is
 * HMAC'd with a server secret.
 */
function sign(timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(`intake:${timestamp}`).digest("base64url");
}

export function issueFormToken(secret: string, now: number = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts, secret)}`;
}

/** Returns the render time if the token is genuine, otherwise null. */
export function readFormToken(token: string, secret: string): number | null {
  const [ts, mac] = token.split(".");
  if (!ts || !mac || !/^\d+$/.test(ts)) return null;
  const expected = Buffer.from(sign(ts, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(ts);
}
