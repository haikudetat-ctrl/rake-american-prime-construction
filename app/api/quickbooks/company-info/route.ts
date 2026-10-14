import { NextResponse } from "next/server";
import { getCompanyInfo } from "@/lib/integrations/quickbooks/api";
import { ownerOr403, qboErrorResponse } from "@/lib/integrations/quickbooks/route-helpers";

export const runtime = "nodejs";

/** Test call: the connected company's CompanyInfo (QBO Accounting API). */
export async function GET() {
  const owner = await ownerOr403();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json(await getCompanyInfo(owner.companyId));
  } catch (err) {
    return qboErrorResponse(err);
  }
}
