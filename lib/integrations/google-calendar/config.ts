import "server-only";

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  tokenKey: Buffer;
};

/**
 * The Google OAuth client (Cloud project "Rake", rake-515615, in American
 * Prime's Google Workspace; internal app, so only their accounts can connect)
 * and the key the refresh token is sealed with. Server-side only.
 */
export function googleCalendarConfig(env: NodeJS.ProcessEnv = process.env): GoogleCalendarConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_TOKEN_KEY) return null;
  const tokenKey = Buffer.from(GOOGLE_TOKEN_KEY, "base64");
  if (tokenKey.length !== 32) {
    throw new Error("GOOGLE_TOKEN_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)");
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, tokenKey };
}

/** For the outbox: never throws, so a bad calendar key can't stop texts and emails going out. */
export function googleCalendarReady(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return googleCalendarConfig(env) !== null;
  } catch {
    return false;
  }
}

/** Rake's own calendars and the events on them, nothing else in the account. */
export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.app.created"];

export const CALLBACK_PATH = "/api/google-calendar/callback";
export const STATE_COOKIE = "gcal_oauth_state";
