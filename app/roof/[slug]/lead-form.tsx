"use client";

import { useState, useTransition } from "react";
import { AddressField } from "@/app/_components/address-field";
import { shrinkPhoto } from "@/lib/images/shrink";
import { CONTACT_CONSENT, MAX_PHOTOS, NEED_LABEL, NEEDS } from "@/lib/leads/schema";

/** Server actions accept ~4 MB per request; leave room for the text fields. */
const MAX_UPLOAD_BYTES = 3_500_000;

export function LeadForm({
  action,
  formToken,
  bad,
}: {
  action: (form: FormData) => Promise<void>;
  formToken: string;
  bad: string[];
}) {
  const [pending, start] = useTransition();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fieldClass = (name: string) => `input ${bad.includes(name) ? "border-danger" : ""}`;

  return (
    <form
      className="card space-y-4"
      action={(form) =>
        start(async () => {
          setPhotoError(null);
          const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
          form.delete("photos");
          const shrunk = await Promise.all(photos.slice(0, MAX_PHOTOS).map((p, i) => shrinkPhoto(p, `roof-${i + 1}.jpg`)));
          let total = 0;
          for (const photo of shrunk) {
            total += photo.size;
            if (total > MAX_UPLOAD_BYTES) {
              setPhotoError("Those photos are too large to send. Try fewer, or send them by text after.");
              return;
            }
            form.append("photos", photo);
          }
          await action(form);
        })
      }
    >
      <input type="hidden" name="formToken" value={formToken} />
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="label">
        <span>What do you need?</span>
        <select name="need" className="input" defaultValue="replacement">
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
      {photoError && <p className="text-sm text-danger">{photoError}</p>}

      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="consent" className="mt-0.5" />
        <span>{CONTACT_CONSENT}</span>
      </label>
      <button disabled={pending} className="btn w-full py-3 text-base">
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
