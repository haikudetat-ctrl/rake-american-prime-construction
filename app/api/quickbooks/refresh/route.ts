import { NextResponse } from "next/server";
import { refreshConnection } from "@/lib/integrations/quickbooks/connection";
import { ownerOr403, qboErrorResponse } from "@/lib/integrations/quickbooks/route-helpers";

export const runtime = "nodejs";

/**
 * Test call: force a refresh-token exchange now. Normal API calls refresh on
 * their own when the access token is within five minutes of expiring; this
 * exists to exercise that path on demand. Returns expiries only, never tokens.
 */
export async function POST() {
  const owner = await ownerOr403();
  if (owner instanceof NextResponse) return owner;
  try {
    const connection = await refreshConnection(owner.companyId);
    return NextResponse.json({
      refreshed: true,
      access_expires_at: connection.accessExpiresAt,
      refresh_expires_at: connection.refreshExpiresAt,
    });
  } catch (err) {
    return qboErrorResponse(err);
  }
}
