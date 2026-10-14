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
