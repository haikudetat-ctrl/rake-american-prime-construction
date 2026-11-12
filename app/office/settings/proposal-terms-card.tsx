import { saveProposalSettings } from "@/app/office/actions";
import { missingNjFacts } from "@/lib/proposals/disclosures";
import { contractorFacts } from "@/lib/proposals/server";

/** Owner-only. The contract terms every proposal is sent with, and the facts NJ requires on it. */
export async function ProposalTermsCard({ companyId }: { companyId: string }) {
  const { settings: s, facts } = await contractorFacts(companyId, null);
  const missing = missingNjFacts(facts);
  return (
    <section className={`card space-y-3 ${s.placeholder || missing.length ? "border-warn/40" : ""}`}>
      <h2 className="font-semibold">Proposal terms</h2>
      {s.placeholder && (
        <p className="text-sm text-warn">
          Placeholder terms. Replace them with your own contract terms, reviewed by your attorney. Proposals can&apos;t be
          sent until you do.
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-sm text-warn">
          Still needed before proposals can be sent: {missing.join(", ")}. The business address and phone come from the
          roofing business name card below.
        </p>
      )}
      <p className="text-xs text-muted">
        Every proposal is sent with your terms, then the contractor details New Jersey requires (legal name, address,
        registration number, insurer, schedule, the Division of Consumer Affairs number) and the three-day cancellation
        notice in bold. You don&apos;t need to type those into the terms.
      </p>
      <form action={saveProposalSettings} className="grid gap-3 sm:grid-cols-3">
        <label className="label sm:col-span-3"><span>Terms (printed on every proposal and signed agreement)</span>
          <textarea name="terms" rows={10} className="input font-mono text-xs" defaultValue={s.terms} />
        </label>
        <label className="label"><span>Legal name on contracts</span>
          <input name="legalName" className="input" placeholder="American Prime Construction LLC" defaultValue={s.legalName ?? ""} />
        </label>
        <label className="label"><span>NJ HIC registration number</span>
          <input name="hicNumber" className="input" defaultValue={s.hicNumber ?? ""} />
        </label>
        <label className="label"><span>Prices good for (days)</span>
          <input name="validDays" type="number" min={1} max={365} className="input" defaultValue={s.validDays} />
        </label>
        <label className="label"><span>Liability insurer</span>
          <input name="insurerName" className="input" defaultValue={s.insurerName ?? ""} />
        </label>
        <label className="label"><span>Insurer phone</span>
          <input name="insurerPhone" type="tel" className="input" defaultValue={s.insurerPhone ?? ""} />
        </label>
        <span />
        <label className="label"><span>Work starts within (days of signing)</span>
          <input name="startWithinDays" type="number" min={1} max={365} className="input" defaultValue={s.startWithinDays ?? ""} />
        </label>
        <label className="label"><span>Work takes up to (working days)</span>
          <input name="finishWithinDays" type="number" min={1} max={365} className="input" defaultValue={s.finishWithinDays ?? ""} />
        </label>
        <button className="btn self-end sm:justify-self-start">Save terms</button>
      </form>
    </section>
  );
}
