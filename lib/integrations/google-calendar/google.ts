import "server-only";
import { GOOGLE_CALENDAR_SCOPES, type GoogleCalendarConfig } from "./config";
import type { CalendarEvent } from "./events";

// Minimal Google OAuth and Calendar v3 client: the handful of calls Rake makes.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 15_000;

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google refused the stored grant (revoked, or the account was removed): reconnect. */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

/** Where the Connect button sends the owner. offline + consent so Google returns a refresh token every time. */
export function authorizeUrl(config: GoogleCalendarConfig, redirectUri: string, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new GoogleError("Google could not be reached", 0);
  }
}

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string | { message?: string }; error_description?: string } | null;
  const message =
    typeof body?.error === "string" ? `${body.error}${body.error_description ? `: ${body.error_description}` : ""}` : body?.error?.message ?? "";
  throw new GoogleError(`${what}: Google ${res.status}${message ? ` ${message}` : ""}`, res.status, body?.error === "invalid_grant");
}

/** The id_token's email claim. It came straight from Google's token endpoint over TLS, so it isn't re-verified. */
function emailFrom(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  config: GoogleCalendarConfig,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; email: string | null }> {
  const res = await call(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) await fail(res, "Connecting to Google");
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string };
  if (!body.access_token || !body.refresh_token) throw new GoogleError("Google didn't return a lasting sign-in. Try connecting again.", 400);
  return { accessToken: body.access_token, refreshToken: body.refresh_token, email: emailFrom(body.id_token) };
}

export async function accessToken(config: GoogleCalendarConfig, refreshToken: string): Promise<string> {
  const res = await call(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) await fail(res, "Renewing the Google sign-in");
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new GoogleError("Google returned no access token", 502);
  return body.access_token;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** A calendar of Rake's own in the connected account. */
export async function createCalendar(token: string, summary: string, timeZone: string): Promise<string> {
  const res = await call(`${CALENDAR_API}/calendars`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      summary,
      timeZone,
      description: "Kept up to date by Rake. Changes made here are overwritten by the next change in Rake.",
    }),
  });
  if (!res.ok) await fail(res, "Creating the Rake calendar");
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new GoogleError("Google returned no calendar id", 502);
  return body.id;
}

/** True if the calendar is still there and Rake can still write to it (it wasn't deleted in Google). */
export async function calendarExists(token: string, calendarId: string): Promise<boolean> {
  const res = await call(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`, { method: "GET", headers: auth(token) });
  if (res.ok) return true;
  if (res.status === 404 || res.status === 403) return false;
  return fail(res, "Checking the Rake calendar");
}

/**
 * Create or replace an event under Rake's own id, so the same job always maps
 * to the same event with no lookup table. An id that was deleted in Google
 * still exists there (cancelled); the replace brings it back.
 */
export async function putEvent(token: string, calendarId: string, event: CalendarEvent): Promise<void> {
  const base = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const body = JSON.stringify({ ...event, status: "confirmed" });
  const inserted = await call(base, { method: "POST", headers: auth(token), body });
  if (inserted.ok) return;
  if (inserted.status !== 409) await fail(inserted, "Adding the event");
  const replaced = await call(`${base}/${event.id}`, { method: "PUT", headers: auth(token), body });
  if (!replaced.ok) await fail(replaced, "Updating the event");
}

/** Gone already counts as done. */
export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  const res = await call(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: "DELETE",
    headers: auth(token),
  });
  if (res.ok || res.status === 404 || res.status === 410) return;
  await fail(res, "Removing the event");
}
