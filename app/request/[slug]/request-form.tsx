"use client";

import { AddressField } from "@/app/_components/address-field";
import { Flash } from "@/app/_components/flash";
import { useIntakeSubmit } from "@/app/_components/use-intake-submit";
import { DUMPSTER_SIZES } from "@/lib/intake/sizes";
import { intakeErrorText, type IntakeFailure } from "@/lib/intake/messages";

export function RequestForm({
  action,
  formToken,
  today,
  tomorrow,
}: {
  action: (form: FormData) => Promise<IntakeFailure | undefined>;
  formToken: string;
  today: string;
  tomorrow: string;
}) {
  const { pending, failure, bad, onSubmit } = useIntakeSubmit(action);
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

        <AddressField label="Job address" formToken={formToken} bad={bad} />

        <div className="grid grid-cols-2 gap-3">
          <label className="label">
            <span>Drop-off date</span>
            <input name="requestedDate" type="date" required min={today} defaultValue={tomorrow}
              className={fieldClass("requestedDate")} />
          </label>
          <label className="label">
            <span>Size</span>
            <select name="sizeYards" className="input" defaultValue="">
              <option value="">Not sure</option>
              {DUMPSTER_SIZES.map((s) => (
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
        <button disabled={pending} className="btn w-full py-3 text-base">
          {pending ? "Sending…" : "Send request"}
        </button>
      </form>
    </>
  );
}
