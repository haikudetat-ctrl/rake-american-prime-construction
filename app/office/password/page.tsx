import Link from "next/link";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { back } from "@/lib/flash";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/sign-in";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Set or change the signed-in person's password. Reached after an email-code
 * sign-in (first time, or forgot it) and from the account menu.
 */
export default async function PasswordPage({ searchParams }: PageProps<"/office/password">) {
  await requireStaff();
  const params = await searchParams;
  const welcome = params.welcome === "1";
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasPassword = Boolean(user?.user_metadata?.password_set);

  async function savePassword(formData: FormData) {
    "use server";
    await requireStaff();
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const here = `/office/password${formData.get("welcome") === "1" ? "?welcome=1" : ""}`;
    if (password.length < MIN_PASSWORD_LENGTH) back(here, `Use at least ${MIN_PASSWORD_LENGTH} characters.`, "error");
    if (password !== confirm) back(here, "The two passwords don't match.", "error");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    const problem = passwordProblem(error);
    if (problem) back(here, problem, "error");
    back("/office", "Password saved. Next time, sign in with your email and password.");
  }

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Account</p>
        <h1 className="page-title">{hasPassword ? "Change your password" : "Set a password"}</h1>
      </header>
      <section className="card max-w-md space-y-4">
        <p className="text-sm text-muted">
          {welcome && !hasPassword
            ? "You're signed in. Set a password so next time you can sign in without waiting for an email."
            : `At least ${MIN_PASSWORD_LENGTH} characters. A short phrase is easier to remember than a jumble.`}
        </p>
        <form action={savePassword} className="space-y-3">
          {welcome && <input type="hidden" name="welcome" value="1" />}
          {/* Lets password managers file the new password under the right account. */}
          <input type="email" name="username" value={user?.email ?? ""} autoComplete="username" readOnly hidden />
          <label className="label">
            <span>New password</span>
            <input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className="input" />
          </label>
          <label className="label">
            <span>Type it again</span>
            <input name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className="input" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn">Save password</button>
            {welcome && (
              <Link href="/office" className="text-sm text-muted underline">Skip for now</Link>
            )}
          </div>
        </form>
      </section>
    </>
  );
}
