import { NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron";
import { drainOutbox } from "@/lib/outbox/drain";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Every few minutes: deliver queued texts and emails. */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  return NextResponse.json(await drainOutbox());
}
