import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/_components/brand";
import { Flash } from "@/app/_components/flash";
import { getMember, homeFor } from "@/lib/auth";
import { normalizeCode, normalizeEmail, signInProblem } from "@/lib/sign-in";
import { sendStaffSignInCode } from "@/lib/staff-sign-in";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Owner and office sign-in: a password, or a one-time code emailed through
 * Resend (which is also how someone sets their first password, or a new one).
 * There is no sign-up: people are added by an owner on the Team page.
 *
 * Codes replaced emailed links, which broke when the email was opened in a
 * different browser from the one that asked (the phone's mail app, say) and
 * could be used up by a mail scanner's preview click.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const member = await getMember();
  if (member) redirect(homeFor(member.role));
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const codeMode = params.mode === "code";
  const email = typeof params.email === "string" ? normalizeEmail(params.email) : "";
  const awaitingCode = codeMode && email !== "";

  async function signInWithPassword(formData: FormData) {
    "use server";
    const email = normalizeEmail(formData.get("email"));
    const password = String(formData.get("password") ?? "");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const problem = signInProblem(error);
      redirect(`/login?error=${problem ?? "credentials"}`);
    }
    redirect("/login");
  }

  async function sendCode(formData: FormData) {
    "use server";
    const email = normalizeEmail(formData.get("email"));
    const result = await sendStaffSignInCode(email);
    if (result === "rate" || result === "system") redirect(`/login?mode=code&error=${result}`);
    const next = `/login?mode=code&email=${encodeURIComponent(email)}`;
    redirect(result === "cooldown" ? `${next}&error=cooldown` : next);
  }

  async function verifyCode(formData: FormData) {
    "use server";
    const email = normalizeEmail(formData.get("email"));
    const token = normalizeCode(formData.get("code"));
    const back = `/login?mode=code&email=${encodeURIComponent(email)}`;
    if (token.length < 6) redirect(`${back}&error=code`);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.user) {
      const problem = signInProblem(error);
      redirect(`${back}&error=${problem === "rate" ? "rate" : "code"}`);
    }
    // First sign-in, or here because they forgot it: offer to set a password.
    redirect(data.user.user_metadata?.password_set ? "/login" : "/office/password?welcome=1");
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-ink p-4">
      <div className="card-stripe w-full max-w-sm space-y-4 shadow-xl">
        <BrandLogo plate={false} className="mx-auto w-52" />
        <div>
          <h1 className="font-display text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted">Office sign-in</p>
        </div>

        {error === "credentials" && (
          <Flash tone="error">
            Wrong email or password. No password yet, or forgot it? Sign in with an email code below.
          </Flash>
        )}
        {error === "code" && <Flash tone="error">That code is wrong or has expired. Check the newest email, or send a new code.</Flash>}
        {error === "cooldown" && <Flash tone="info">A code was just sent. Check your inbox (and spam), or wait a minute to send another.</Flash>}
        {error === "link" && <Flash tone="error">Sign-in links are no longer used. Sign in with your password or an email code.</Flash>}
        {error === "rate" && <Flash tone="error">Too many sign-in attempts. Wait a few minutes and try again.</Flash>}
        {error === "system" && <Flash tone="error">Couldn&apos;t sign you in right now. Try again, or contact 2Stack support.</Flash>}

        {awaitingCode ? (
          <>
            {error !== "cooldown" && error !== "code" && (
              <Flash tone="ok">If {email} is on the team, a sign-in code is on its way. It can take a minute.</Flash>
            )}
            <form action={verifyCode} className="space-y-3">
              <input type="hidden" name="email" value={email} />
              <label className="label">
                <span>Code from the email</span>
                <input
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={12}
                  className="input text-center font-mono text-xl tracking-[0.3em]"
                />
              </label>
              <button className="btn w-full">Sign in</button>
            </form>
            <div className="flex items-center justify-between gap-3 text-sm text-muted">
              <form action={sendCode}>
                <input type="hidden" name="email" value={email} />
                <button className="underline">Send a new code</button>
              </form>
              <Link href="/login?mode=code" className="underline">Use a different email</Link>
            </div>
          </>
        ) : codeMode ? (
          <>
            <form action={sendCode} className="space-y-3">
              <label className="label">
                <span>Email</span>
                <input name="email" type="email" required autoComplete="email" className="input" />
              </label>
              <button className="btn w-full">Email me a code</button>
            </form>
            <p className="text-sm text-muted">
              Have a password? <Link href="/login" className="underline">Sign in with it</Link>
            </p>
          </>
        ) : (
          <>
            <form action={signInWithPassword} className="space-y-3">
              <label className="label">
                <span>Email</span>
                <input name="email" type="email" required autoComplete="username" className="input" />
              </label>
              <label className="label">
                <span>Password</span>
                <input name="password" type="password" required autoComplete="current-password" className="input" />
              </label>
              <button className="btn w-full">Sign in</button>
            </form>
            <Link href="/login?mode=code" className="btn-secondary w-full text-center">
              No password yet, or forgot it? Email me a code
            </Link>
          </>
        )}

        <p className="text-sm text-muted">
          Driving today? <Link href="/login/driver" className="underline">Sign in with your phone</Link>
        </p>
      </div>
    </main>
  );
}
