import { savePhoneSettings } from "@/app/office/actions";
import { loadPhoneSettings } from "@/lib/phone/server";
import { formatPhone } from "@/lib/phone";

const DAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
] as const;

/** Owner-only. Who the business number rings, when, and what callers hear. */
export async function PhoneCard({ companyId }: { companyId: string }) {
  const s = await loadPhoneSettings({ companyId });
  const appUrl = process.env.APP_URL ?? "";
  const ready = Boolean(process.env.TWILIO_AUTH_TOKEN);
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Business phone</h2>
      {!ready && <p className="text-sm text-warn">Add TWILIO_AUTH_TOKEN to the deployment so calls and texts can be received.</p>}
      <form action={savePhoneSettings} className="grid gap-3 sm:grid-cols-2">
        <label className="label"><span>Business number (the Twilio number)</span>
          <input name="businessNumber" type="tel" className="input" defaultValue={s.businessNumber ? formatPhone(s.businessNumber) : ""} />
        </label>
        <label className="label"><span>Ring these phones at once (one per line)</span>
          <textarea name="ringNumbers" rows={2} className="input" defaultValue={s.ringNumbers.map(formatPhone).join("\n")} />
        </label>
        <fieldset className="label">
          <span>Open days</span>
          <div className="flex flex-wrap gap-3 text-sm">
            {DAYS.map(([n, label]) => (
              <label key={n} className="flex items-center gap-1">
                <input type="checkbox" name="openDays" value={n} defaultChecked={s.openDays.includes(n)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-3 gap-2">
          <label className="label"><span>Opens</span><input name="openTime" type="time" className="input" defaultValue={s.openTime} /></label>
          <label className="label"><span>Closes</span><input name="closeTime" type="time" className="input" defaultValue={s.closeTime} /></label>
          <label className="label"><span>Ring (sec)</span><input name="ringSeconds" type="number" min={10} max={60} className="input" defaultValue={s.ringSeconds} /></label>
        </div>
        <label className="label"><span>Greeting when nobody answers</span>
          <textarea name="greeting" rows={3} maxLength={600} className="input" defaultValue={s.greeting} />
        </label>
        <label className="label"><span>Greeting after hours</span>
          <textarea name="afterHoursGreeting" rows={3} maxLength={600} className="input" defaultValue={s.afterHoursGreeting} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="notifyTexts" defaultChecked={s.notifyTexts} />
          Text owner and office when a customer texts the business number
        </label>
        <button className="btn sm:justify-self-start">Save phone settings</button>
      </form>
      <details className="text-sm">
        <summary className="cursor-pointer">Twilio setup</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>Twilio Console → Phone Numbers → the business number → Voice: &quot;A call comes in&quot; → Webhook, POST,{" "}
            <code>{appUrl}/api/twilio/voice</code></li>
          <li>Messaging → Services → the American Prime service → Integration → Incoming messages: &quot;Send a webhook&quot;,{" "}
            <code>{appUrl}/api/twilio/sms</code>. Make sure the business number is in that service&apos;s sender pool.</li>
          <li>Whoever answers hears &quot;Press 1 to answer&quot;, so a personal voicemail never takes the call.</li>
        </ol>
      </details>
    </section>
  );
}
