/**
 * Classifies a Supabase sign-in error into what the person should be told.
 *
 * Errors that depend on whether the address or phone has an account (no such
 * user, sign-ups disabled) return null, so the page answers the same way for
 * everyone. Rate limits and failures that are ours (bad API key, outage) are
 * reported, because staying silent about them hides a broken system — which
 * is exactly how a wrong publishable key went unnoticed at launch.
 */
export type SignInProblem = "rate" | "system";

/** Passwords shorter than this are refused before Supabase sees them. */
export const MIN_PASSWORD_LENGTH = 10;

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Keeps the digits of a typed or pasted code ("123 456", "123-456"). */
export function normalizeCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * The office sign-in email. Plain text, code in the subject so it shows in the
 * phone's notification, and no link: a link can be used up by a mail
 * scanner's preview click, and only works in the browser that asked for it.
 */
export function signInCodeEmail(input: { company: string; code: string }): { subject: string; text: string } {
  return {
    subject: `${input.code} is your ${input.company} sign-in code`,
    text: [
      `Your sign-in code for ${input.company} is:`,
      "",
      input.code,
      "",
      "Type it on the sign-in page. It works once and expires within an hour.",
      "",
      "If you didn't ask for this, you can ignore this email. Nobody can sign in without the code.",
    ].join("\n"),
  };
}

/**
 * What to tell someone whose new password was refused. Supabase's own
 * strength rules (set in the dashboard) come back as `weak_password` with a
 * readable message; anything unexpected is reported as ours.
 */
export function passwordProblem(error: { code?: string; message?: string; status?: number } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "same_password") return "That's already your password. Pick a different one.";
  if (error.code === "weak_password") return error.message || "Pick a stronger password.";
  if (error.code === "reauthentication_needed" || error.code === "session_expired" || error.status === 401) {
    return "For security, sign in again with an email code, then set your password.";
  }
  return "Couldn't save your password right now. Try again, or contact 2Stack support.";
}

export function signInProblem(error: { status?: number; code?: string } | null | undefined): SignInProblem | null {
  if (!error) return null;
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_sms_send_rate_limit") {
    return "rate";
  }
  if (error.status === undefined || error.status === 401 || error.status === 403 || error.status >= 500) {
    return "system";
  }
  return null;
}
