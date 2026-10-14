import "server-only";
import { NextResponse } from "next/server";
import { getMember, type Member } from "@/lib/auth";
import { QboError, toQboError } from "@/lib/integrations/quickbooks/errors";

export const STATE_COOKIE = "qbo_oauth_state";

/** Owner-only guard for the QuickBooks routes. */
export async function ownerOr403(): Promise<Member | NextResponse> {
  const member = await getMember();
  if (!member || member.role !== "owner") {
    return NextResponse.json({ error: "forbidden", message: "Only an owner can manage QuickBooks." }, { status: 403 });
  }
  return member;
}

/** JSON error body with Intuit's transaction id, for the test routes. */
export function qboErrorResponse(err: unknown): NextResponse {
  const error = err instanceof QboError ? err : toQboError(err);
  const status =
    error.kind === "not_configured" || error.kind === "not_connected" ? 409
    : error.kind === "reconnect" ? 401
    : error.kind === "rate_limited" ? 429
    : error.kind === "unavailable" ? 503
    : 502;
  return NextResponse.json(error.toJSON(), { status });
}
