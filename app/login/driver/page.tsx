import { redirect } from "next/navigation";
import { BrandLogo } from "@/app/_components/brand";
import { Flash } from "@/app/_components/flash";
import { getMember, homeFor } from "@/lib/auth";
import { signInProblem } from "@/lib/sign-in";
import { isLocale, translator } from "@/lib/i18n";
import { formatPhone, toE164 } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Driver sign-in by text-message code (Supabase phone auth, sent through
 * Twilio Verify). Two steps on one page: the phone number travels in the
 * query string between them.
 */
export default async function DriverLoginPage({ searchParams }: PageProps<"/login/driver">) {
  const member = await getMember();
  if (member) redirect(homeFor(member.role));
  const { phone, error, lang } = await searchParams;
  const locale = isLocale(lang) ? lang : "en";
  const t = translator(locale);
  const e164 = typeof phone === "string" ? toE164(phone) : null;

  async function sendCode(formData: FormData) {
    "use server";
    const lang = String(formData.get("lang") ?? "en");
    const to = toE164(String(formData.get("phone") ?? ""));
    if (!to) redirect(`/login/driver?error=phone&lang=${lang}`);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({ phone: to, options: { shouldCreateUser: false } });
    const problem = signInProblem(error);
    if (problem) redirect(`/login/driver?error=${problem}&lang=${lang}`);
    redirect(`/login/driver?phone=${encodeURIComponent(to)}&lang=${lang}`);
  }

  async function verifyCode(formData: FormData) {
    "use server";
    const lang = String(formData.get("lang") ?? "en");
    const to = toE164(String(formData.get("phone") ?? ""));
    const token = String(formData.get("code") ?? "").replace(/\D/g, "");
    if (!to) redirect(`/login/driver?error=phone&lang=${lang}`);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ phone: to, token, type: "sms" });
    if (error) redirect(`/login/driver?phone=${encodeURIComponent(to)}&error=code&lang=${lang}`);
    redirect("/login/driver");
  }

  const other = locale === "en" ? "es" : "en";

  return (
    <main className="flex flex-1 items-center justify-center bg-ink p-4">
      <div className="card-stripe w-full max-w-sm space-y-4 shadow-xl">
        <BrandLogo plate={false} className="mx-auto w-52" />
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">Sign in</h1>
            <p className="text-sm text-muted">{t("login.phoneTitle")}</p>
          </div>
          <a className="btn-secondary" href={`/login/driver?lang=${other}${e164 ? `&phone=${encodeURIComponent(e164)}` : ""}`}>
            {t("driver.language")}
          </a>
        </div>
        {error === "phone" && <Flash tone="error">{t("login.badPhone")}</Flash>}
        {error === "code" && <Flash tone="error">{t("login.badCode")}</Flash>}
        {error === "rate" && <Flash tone="error">{t("login.rateLimited")}</Flash>}
        {error === "system" && <Flash tone="error">{t("login.systemError")}</Flash>}

        {!e164 ? (
          <form action={sendCode} className="space-y-3">
            <input type="hidden" name="lang" value={locale} />
            <label className="label">
              <span>{t("login.phone")}</span>
              <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="input" />
            </label>
            <button className="btn w-full py-3 text-base">{t("login.sendCode")}</button>
          </form>
        ) : (
          <form action={verifyCode} className="space-y-3">
            <input type="hidden" name="lang" value={locale} />
            <input type="hidden" name="phone" value={e164} />
            <p className="text-sm text-muted">{formatPhone(e164)}</p>
            <label className="label">
              <span>{t("login.code")}</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                required
                className="input text-center text-2xl tracking-widest"
              />
            </label>
            <button className="btn w-full py-3 text-base">{t("login.verify")}</button>
          </form>
        )}
      </div>
    </main>
  );
}
