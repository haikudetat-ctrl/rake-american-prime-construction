import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Flash } from "@/app/_components/flash";
import { addDays, companyToday } from "@/lib/dates";
import { loadRequestLink, newFormToken, submitRentalRequest } from "@/lib/intake/submit";

export const metadata: Metadata = { title: "Request a dumpster" };

const ERRORS: Record<string, string> = {
  invalid: "Check the highlighted fields and try again.",
  rate_limited: "We've received several requests from you already. Call or text us instead.",
  past_date: "Pick today or a later date.",
  failed: "Something went wrong on our end. Please call or text us.",
};

const SIZES = [10, 15, 20, 30];

export default async function RequestPage({ params, searchParams }: PageProps<"/request/[slug]">) {
  const { slug } = await params;
  const { error, fields } = await searchParams;
  const link = await loadRequestLink(slug);
  if (!link) notFound();

  const today = companyToday();
  const formToken = newFormToken();
  const bad = new Set(typeof fields === "string" ? fields.split(",") : []);
  const fieldClass = (name: string) => `input ${bad.has(name) ? "border-danger" : ""}`;

  async function submit(formData: FormData) {
    "use server";
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
    const result = await submitRentalRequest(slug, formData, ip);
    if (result.ok) redirect(`/request/${slug}/thanks`);
    if (result.error === "unknown_link") notFound();
    const query = new URLSearchParams({ error: result.error });
    if (result.fields?.length) query.set("fields", result.fields.join(","));
    redirect(`/request/${slug}?${query}`);
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-4 p-4">
      <header>
        <p className="text-sm text-muted">{link.brandName}</p>
        <h1 className="text-2xl font-semibold">Request a dumpster</h1>
        <p className="text-sm text-muted">
          Tell us where and when. We&apos;ll confirm by text before we drop it off.
        </p>
      </header>

      {typeof error === "string" && ERRORS[error] && <Flash tone="error">{ERRORS[error]}</Flash>}

      <form action={submit} className="card space-y-4">
        <input type="hidden" name="formToken" value={formToken} />
        {/* Honeypot: hidden from people, filled by bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px]">
          <label>
            Website <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <label className="label">
          <span>Job address</span>
          <input name="address" required autoComplete="street-address" className={fieldClass("address")}
            placeholder="Street, town" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="label">
            <span>Drop-off date</span>
            <input name="requestedDate" type="date" required min={today} defaultValue={addDays(today, 1)}
              className={fieldClass("requestedDate")} />
          </label>
          <label className="label">
            <span>Size</span>
            <select name="sizeYards" className="input" defaultValue="">
              <option value="">Not sure</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>{s} yard</option>
              ))}
            </select>
          </label>
        </div>

        <label className="label">
          <span>Your name</span>
          <input name="contactName" required autoComplete="name" className={fieldClass("contactName")} />
        </label>
        <label className="label">
          <span>Company (if any)</span>
          <input name="companyName" autoComplete="organization" className="input" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="label">
            <span>Mobile phone</span>
            <input name="phone" type="tel" required autoComplete="tel" className={fieldClass("phone")} />
          </label>
          <label className="label">
            <span>Email for the invoice</span>
            <input name="email" type="email" autoComplete="email" className={fieldClass("email")} />
          </label>
        </div>
        <label className="label">
          <span>Anything we should know?</span>
          <textarea name="notes" rows={3} className="input"
            placeholder="Where to put it, gate codes, tight driveway…" />
        </label>

        <p className="text-xs text-muted">
          By sending this you agree we may call or text you about this rental. Message and data rates may apply.
        </p>
        <button className="btn w-full py-3 text-base">Send request</button>
      </form>
    </main>
  );
}
