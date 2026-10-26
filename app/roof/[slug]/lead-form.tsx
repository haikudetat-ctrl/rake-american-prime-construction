"use client";

import { AddressField } from "@/app/_components/address-field";
import { Flash } from "@/app/_components/flash";
import { useIntakeSubmit } from "@/app/_components/use-intake-submit";
import { shrinkPhoto } from "@/lib/images/shrink";
import { intakeErrorText, type IntakeFailure } from "@/lib/intake/messages";
import { CONTACT_CONSENT, MAX_PHOTOS, NEED_LABEL, NEEDS, type Need } from "@/lib/leads/schema";

/** Server actions accept ~4 MB per request; leave room for the text fields. */
const MAX_UPLOAD_BYTES = 3_500_000;

/** Phone photos shrunk in the browser, or a message if they still won't fit. */
async function shrinkPhotos(form: FormData): Promise<string | null> {
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  form.delete("photos");
  const shrunk = await Promise.all(photos.slice(0, MAX_PHOTOS).map((p, i) => shrinkPhoto(p, `roof-${i + 1}.jpg`)));
  let total = 0;
  for (const photo of shrunk) {
    total += photo.size;
    if (total > MAX_UPLOAD_BYTES) return "Those photos are too large to send. Try fewer, or send them by text after.";
    form.append("photos", photo);
  }
  return null;
}

/** The homeowner's estimate request: the roofing link and a past customer's referral link. */
export function LeadForm({
  action,
  formToken,
  defaultNeed = "replacement",
}: {
  action: (form: FormData) => Promise<IntakeFailure | undefined>;
  formToken: string;
  /** Preselected from a website link, e.g. /roof/roof?need=gutters. */
  defaultNeed?: Need;
}) {
  const { pending, failure, problem, bad, onSubmit } = useIntakeSubmit(action, shrinkPhotos);
  const fieldClass = (name: string) => `input ${bad.includes(name) ? "border-danger" : ""}`;

  return (
    <>
      {failure && <Flash tone="error">{intakeErrorText(failure)}</Flash>}

      <form onSubmit={onSubmit} method="post" className="card space-y-4">
        <input type="hidden" name="formToken" value={formToken} />
        {/* Honeypot: hidden from people, filled by bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px]">
          <label>
            Website <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <label className="label">
          <span>What do you need?</span>
          <select name="need" className="input" defaultValue={defaultNeed}>
            {NEEDS.map((n) => <option key={n} value={n}>{NEED_LABEL[n]}</option>)}
          </select>
        </label>
        <AddressField label="Property address" formToken={formToken} bad={bad} />
        <label className="label">
          <span>Your name</span>
          <input name="name" required autoComplete="name" className={fieldClass("name")} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="label">
            <span>Mobile phone</span>
            <input name="phone" type="tel" required autoComplete="tel" className={fieldClass("phone")} />
          </label>
          <label className="label">
            <span>Email (optional)</span>
            <input name="email" type="email" autoComplete="email" className={fieldClass("email")} />
          </label>
        </div>
        <label className="label">
          <span>Tell us about it</span>
          <textarea name="notes" rows={3} className="input"
            placeholder="Where it leaks, how old the roof is, best time to reach you…" />
        </label>
        <label className="label">
          <span>Photos (optional, up to {MAX_PHOTOS})</span>
          <input name="photos" type="file" accept="image/*" multiple className="input" />
        </label>
        {problem && <p className="text-sm text-danger">{problem}</p>}

        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" name="consent" className="mt-0.5" />
          <span>{CONTACT_CONSENT}</span>
        </label>
        <button disabled={pending} className="btn w-full py-3 text-base">
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </>
  );
}
