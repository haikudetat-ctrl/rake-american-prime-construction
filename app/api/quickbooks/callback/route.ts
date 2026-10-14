import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { completeConnection } from "@/lib/integrations/quickbooks/connection";
import { toQboError } from "@/lib/integrations/quickbooks/errors";
import { ownerOr403, STATE_COOKIE } from "@/lib/integrations/quickbooks/route-helpers";

export const runtime = "nodejs";

function settings(request: NextRequest, key: "notice" | "error", message: string) {
  const url = new URL("/office/settings", request.url);
  url.searchParams.set(key, message);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/quickbooks" });
  return response;
}

/**
 * Step 2: Intuit redirects here with ?code=&realmId=&state= (or ?error= if the
 * owner declined). Verify state, exchange the code, store encrypted tokens.
 */
export async function GET(request: NextRequest) {
  const owner = await ownerOr403();
  if (owner instanceof NextResponse) return owner;
  const params = request.nextUrl.searchParams;

  if (params.get("error")) return settings(request, "error", "QuickBooks connection was not approved.");

  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const given = params.get("state") ?? "";
  const valid =
    expected.length > 0 &&
    expected.length === given.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  if (!valid) return settings(request, "error", "QuickBooks sign-in expired or didn't match. Try connecting again.");
  if (!params.get("code")) return settings(request, "error", "Intuit didn't return an authorization code.");

  try {
    const connection = await completeConnection(owner.companyId, request.url, owner.userId);
    return settings(request, "notice", `QuickBooks (${connection.environment}) connected.`);
  } catch (err) {
    const error = toQboError(err);
    console.error("QuickBooks connect failed", { kind: error.kind, intuit_tid: error.intuitTid });
    return settings(request, "error", error.message);
  }
}
