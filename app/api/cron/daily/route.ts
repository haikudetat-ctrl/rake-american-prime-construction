import { NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron";
import { companyToday } from "@/lib/dates";
import { drainOutbox } from "@/lib/outbox/drain";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Once each morning: queue overdue reminders, and on Mondays issue the
 * weekly statements. Both are idempotent, so a retried or doubled cron run
 * sends nothing twice. Then deliver what was queued.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const db = adminClient();
  const isMonday = new Date(`${companyToday()}T12:00:00Z`).getUTCDay() === 1;
  const { data: companies, error } = await db.from("companies").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const company of companies ?? []) {
    const statements = isMonday ? await db.rpc("issue_statements", { p_company_id: company.id }) : null;
    const reminders = await db.rpc("enqueue_overdue_reminders", { p_company_id: company.id });
    results.push({
      company: company.id,
      statements: statements?.error ? statements.error.message : (statements?.data?.length ?? 0),
      reminders: reminders.error ? reminders.error.message : reminders.data,
    });
  }
  return NextResponse.json({ isMonday, results, delivery: await drainOutbox(50) });
}
