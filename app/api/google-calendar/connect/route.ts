import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { CALLBACK_PATH, googleCalendarConfig, STATE_COOKIE } from "@/lib/integrations/google-calendar/config";
import { authorizeUrl } from "@/lib/integrations/google-calendar/google";

export const runtime = "nodejs";

/**
 * Step 1: send the owner to Google to approve Rake's calendar access. Google
 * comes back to the same address the owner is on (www.apconstructionnj.com or
 * the vercel.app one; both are registered), so the sign-in and the state
 * cookie are there for the callback. The state stops another site from
 * completing a connection in this browser.
 */
export async function GET(request: Request) {
  const member = await getMember();
  if (!member || member.role !== "owner") {
    return NextResponse.json({ error: "forbidden", message: "Only an owner can connect Google Calendar." }, { status: 403 });
  }
  const config = googleCalendarConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/office/settings?error=Google+Calendar+is+not+set+up+on+this+deployment", request.url));
  }
  const url = new URL(request.url);
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(config, `${url.origin}${CALLBACK_PATH}`, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax", // must survive the top-level redirect back from Google
    path: "/api/google-calendar",
    maxAge: 10 * 60,
  });
  return response;
}
