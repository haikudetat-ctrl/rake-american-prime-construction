import { NextResponse } from "next/server";
import { getUserInfo } from "@/lib/integrations/quickbooks/api";
import { ownerOr403, qboErrorResponse } from "@/lib/integrations/quickbooks/route-helpers";

export const runtime = "nodejs";

/** Test call: OpenID Connect userinfo for the Intuit user who connected. */
export async function GET() {
  const owner = await ownerOr403();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json(await getUserInfo(owner.companyId));
  } catch (err) {
    return qboErrorResponse(err);
  }
}
