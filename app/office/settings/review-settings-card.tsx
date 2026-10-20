import { saveReviewSettings } from "@/app/office/actions";
import { adminClient } from "@/lib/supabase/admin";

/** Owner-only. Google review link, referral reward, and timing of the aftercare texts. */
export async function ReviewSettingsCard({ companyId }: { companyId: string }) {
  const { data: s } = await adminClient().from("review_settings").select("*").eq("company_id", companyId).maybeSingle();
  return (
    <section className={`card space-y-3 ${s?.google_review_url ? "" : "border-warn/40"}`}>
      <h2 className="font-semibold">Reviews and referrals</h2>
      {!s?.google_review_url && (
        <p className="text-sm text-warn">
          Add your Google review link (Google Business Profile → Ask for reviews → copy link). Until then happy customers get
          their referral link but no review button.
        </p>
      )}
      <form action={saveReviewSettings} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        <label className="label sm:col-span-4"><span>Google review link</span>
          <input name="googleReviewUrl" type="url" placeholder="https://g.page/r/…/review" defaultValue={s?.google_review_url ?? ""} className="input" />
        </label>
        <label className="label"><span>Referral reward ($)</span>
          <input name="reward" inputMode="decimal" defaultValue={((s?.reward_cents ?? 10000) / 100).toFixed(2)} className="input" />
        </label>
        <label className="label"><span>&quot;How did we do?&quot; after (hours)</span>
          <input name="feedbackDelayHours" type="number" min={0} max={336} defaultValue={s?.feedback_delay_hours ?? 24} className="input" />
        </label>
        <label className="label"><span>Referral link after (days)</span>
          <input name="referralDelayDays" type="number" min={0} max={60} defaultValue={s?.referral_delay_days ?? 3} className="input" />
        </label>
        <button className="btn sm:justify-self-start">Save</button>
      </form>
      <p className="text-xs text-muted">The reward amount applies to new referrals; existing ones keep theirs.</p>
    </section>
  );
}
