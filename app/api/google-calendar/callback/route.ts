import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { CALLBACK_PATH, googleCalendarConfig, STATE_COOKIE } from "@/lib/integrations/google-calendar/config";
import { calendarExists, createCalendar, exchangeCode, GoogleError } from "@/lib/integrations/google-calendar/google";
import { loadConnection, saveConnection } from "@/lib/integrations/google-calendar/sync";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CALENDAR_NAME = "Rake jobs";

function settings(request: NextRequest, key: "notice" | "error", message: string) {
  const url = new URL("/office/settings", request.url);
  url.searchParams.set(key, message);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/google-calendar" });
  return response;
}

/**
 * Step 2: Google redirects here with ?code=&state= (or ?error= if the owner
 * declined). Check the state, trade the code for a lasting sign-in, make (or
 * keep) the Rake calendar, and queue everything from the last week on.
 */
export async function GET(request: NextRequest) {
  const member = await getMember();
  if (!member || member.role !== "owner") {
    return NextResponse.json({ error: "forbidden", message: "Only an owner can connect Google Calendar." }, { status: 403 });
  }
  const config = googleCalendarConfig();
  if (!config) return settings(request, "error", "Google Calendar is not set up on this deployment.");
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return settings(request, "error", "Google Calendar access was not approved.");

  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const given = params.get("state") ?? "";
  const valid =
    expected.length > 0 && expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  if (!valid) return settings(request, "error", "Google sign-in expired or didn't match. Try connecting again.");
  const code = params.get("code");
  if (!code) return settings(request, "error", "Google didn't return an authorization code.");

  try {
    const redirectUri = `${request.nextUrl.origin}${CALLBACK_PATH}`;
    const granted = await exchangeCode(config, code, redirectUri);
    const { data: company } = await adminClient().from("companies").select("timezone").eq("id", member.companyId).single();

    // Reconnecting the same account keeps its calendar; anything else gets a new one.
    const existing = await loadConnection(member.companyId, config).catch(() => null);
    const keep =
      existing && existing.googleEmail === granted.email && (await calendarExists(granted.accessToken, existing.calendarId));
    const calendarId = keep
      ? existing.calendarId
      : await createCalendar(granted.accessToken, CALENDAR_NAME, (company as { timezone: string } | null)?.timezone ?? "America/New_York");

    await saveConnection(config, {
      companyId: member.companyId,
      googleEmail: granted.email,
      calendarId,
      refreshToken: granted.refreshToken,
      connectedBy: member.userId,
    });
    const { data: queued } = await adminClient().rpc("calendar_backfill", { p_company_id: member.companyId });
    const who = granted.email ? ` as ${granted.email}` : "";
    return settings(
      request,
      "notice",
      `Google Calendar connected${who}. "${CALENDAR_NAME}" is filling in now (${Number(queued ?? 0)} jobs and stops); give it a few minutes.`,
    );
  } catch (err) {
    console.error("Google Calendar connect failed", { message: (err as Error).message });
    return settings(request, "error", err instanceof GoogleError ? err.message : "Connecting Google Calendar failed. Try again.");
  }
}
