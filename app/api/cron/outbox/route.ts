import { NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron";
import { qboConfig } from "@/lib/integrations/quickbooks/config";
import { syncAllCompanies } from "@/lib/integrations/quickbooks/sync";
import { drainOutbox } from "@/lib/outbox/drain";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Every few minutes: deliver queued texts and emails, then sync QuickBooks where it is on. */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const outbox = await drainOutbox();
  const quickbooks = qboConfig() ? await syncAllCompanies().catch((err: Error) => ({ error: err.message })) : null;
  return NextResponse.json({ ...outbox, quickbooks });
}
