import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { qboConfig } from "@/lib/integrations/quickbooks/config";
import { newOAuthClient, QBO_SCOPES } from "@/lib/integrations/quickbooks/connection";
import { ownerOr403, STATE_COOKIE } from "@/lib/integrations/quickbooks/route-helpers";

export const runtime = "nodejs";

/**
 * Step 1: send the owner to Intuit to approve access and pick a company.
 * A random `state` is kept in an HttpOnly cookie and must come back unchanged
 * on the callback, which stops another site from completing a connection in
 * this browser (CSRF).
 */
export async function GET(request: Request) {
  const owner = await ownerOr403();
  if (owner instanceof NextResponse) return owner;
  const config = qboConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/office/settings?error=QuickBooks+is+not+configured+on+this+deployment", request.url));
  }

  const state = randomBytes(24).toString("base64url");
  const authorizeUrl = newOAuthClient(config).authorizeUri({ scope: QBO_SCOPES, state });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax", // must survive the top-level redirect back from Intuit
    path: "/api/quickbooks",
    maxAge: 10 * 60,
  });
  return response;
}
