import "server-only";
import { z } from "zod";
import { FORM_TOKEN_MAX_AGE_MS } from "@/lib/intake/schema";
import { intakeSecret } from "@/lib/intake/submit";
import { readFormToken } from "@/lib/intake/token";

/**
 * Guards for /api/places/*: the public forms' address search.
 *
 * Each call costs money on the Google key, so a caller must hold a form token
 * minted when one of our forms rendered (lib/intake/token.ts). That stops
 * drive-by use of the endpoint; it does not stop a bot that loads the page
 * first. The hard ceiling is the per-day quota on the key in Google Cloud.
 */

const base = {
  token: z.string().max(200),
  // Client-made UUID grouping one search into one Google billing session.
  session: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
};

export const searchBody = z.object({ ...base, q: z.string().trim().min(3).max(200) });
export const detailsBody = z.object({ ...base, placeId: z.string().max(300) });

export function tokenIsLive(token: string, now = Date.now()): boolean {
  const renderedAt = readFormToken(token, intakeSecret());
  return renderedAt !== null && now - renderedAt < FORM_TOKEN_MAX_AGE_MS && renderedAt <= now + 60_000;
}

/*
 * Best-effort per-IP brake. It lives in one server instance's memory, so it
 * resets on cold starts and isn't shared across instances; it only blunts a
 * single client hammering the box.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = 120;
const hits = new Map<string, { count: number; resetAt: number }>();

export function overLimit(ip: string, now = Date.now()): boolean {
  if (hits.size > 5_000) hits.clear();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_CALLS;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}
