import "server-only";
import { sendEmail } from "@/lib/integrations/resend";
import { normalizeEmail, signInCodeEmail } from "@/lib/sign-in";
import { adminClient } from "@/lib/supabase/admin";

export type CodeSendResult = "sent" | "cooldown" | "rate" | "system";

/**
 * Emails an office sign-in code through Resend.
 *
 * Supabase Auth still issues and checks the code (`generateLink` makes it
 * without sending anything; `verifyOtp` on the sign-in page checks it). Only
 * delivery is ours, because Supabase's built-in mailer reaches nobody outside
 * the Supabase team. `claim_staff_email_code` throttles every address the
 * same way and says whether it belongs to active staff, so the page can
 * answer "sent" whether or not the address has an account.
 */
export async function sendStaffSignInCode(rawEmail: unknown): Promise<CodeSendResult> {
  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) return "sent";

  const apiKey = process.env.AUTH_RESEND_API_KEY ?? process.env.RESEND_API_KEY;
  const fromAddress = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !fromAddress) {
    console.error("[sign-in] AUTH_RESEND_API_KEY / AUTH_EMAIL_FROM not set; cannot email codes");
    return "system";
  }

  const admin = adminClient();
  const { data: claim, error: claimError } = await admin.rpc("claim_staff_email_code", { p_email: email }).single<{
    status: "send" | "unknown" | "cooldown" | "limit";
    company: string | null;
  }>();
  if (claimError || !claim) {
    console.error("[sign-in] throttle check failed", claimError?.message);
    return "system";
  }
  if (claim.status === "unknown") return "sent";
  if (claim.status === "cooldown") return "cooldown";
  if (claim.status === "limit") return "rate";

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const code = link.data?.properties?.email_otp;
  if (link.error || !code) {
    console.error("[sign-in] could not issue a code", link.error?.code ?? link.error?.message);
    return link.error?.status === 429 ? "rate" : "system";
  }

  const company = claim.company ?? "Rake";
  try {
    await sendEmail({ apiKey, from: `${company} <${fromAddress}>`, to: email, ...signInCodeEmail({ company, code }) });
  } catch (error) {
    console.error("[sign-in] Resend refused the code email", error instanceof Error ? error.message : error);
    return "system";
  }
  return "sent";
}
