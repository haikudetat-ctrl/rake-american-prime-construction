import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Flash } from "@/app/_components/flash";
import { getMember, homeFor } from "@/lib/auth";
import { signInProblem } from "@/lib/sign-in";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Owner and office sign-in by emailed link. There is no sign-up: people are
 * added by an owner on the Team page, and `shouldCreateUser: false` keeps a
 * typed-in address from creating an account.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const member = await getMember();
  if (member && member.role !== "crew") redirect(homeFor(member.role));
  const { sent, error } = await searchParams;

  async function sendLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const origin = (await headers()).get("origin") ?? process.env.APP_URL ?? "";
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
    });
    // Same response whether or not the address has an account; only failures
    // that aren't about the address (limits, misconfiguration) are shown.
    const problem = signInProblem(error);
    redirect(problem ? `/login?error=${problem}` : "/login?sent=1");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold">American Prime</h1>
          <p className="text-sm text-muted">Office sign-in</p>
        </div>
        {sent && <Flash tone="ok">If that address is on the team, a sign-in link is on its way.</Flash>}
        {error === "link" && <Flash tone="error">That link expired or was already used. Send a new one.</Flash>}
        {error === "rate" && <Flash tone="error">Too many sign-in attempts. Wait a few minutes and try again.</Flash>}
        {error === "system" && <Flash tone="error">Couldn&apos;t send the link right now. Try again, or contact 2Stack support.</Flash>}
        <form action={sendLink} className="space-y-3">
          <label className="label">
            <span>Email</span>
            <input name="email" type="email" required autoComplete="email" className="input" />
          </label>
          <button className="btn w-full">Email me a sign-in link</button>
        </form>
        <p className="text-sm text-muted">
          Driving today? <Link href="/login/driver" className="underline">Sign in with your phone</Link>
        </p>
      </div>
    </main>
  );
}
