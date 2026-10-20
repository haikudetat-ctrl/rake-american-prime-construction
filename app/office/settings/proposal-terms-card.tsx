import { saveProposalSettings } from "@/app/office/actions";
import { loadProposalSettings } from "@/lib/proposals/server";

/** Owner-only. The contract terms every proposal is sent with. */
export async function ProposalTermsCard({ companyId }: { companyId: string }) {
  const s = await loadProposalSettings(companyId);
  return (
    <section className={`card space-y-3 ${s.placeholder ? "border-warn/40" : ""}`}>
      <h2 className="font-semibold">Proposal terms</h2>
      {s.placeholder && (
        <p className="text-sm text-warn">
          Placeholder terms. Replace them with your own contract terms, reviewed by your attorney: New Jersey home
          improvement contracts must include specific items (your registration number, the right to cancel within three
          business days, and more).
        </p>
      )}
      <form action={saveProposalSettings} className="grid gap-3 sm:grid-cols-3">
        <label className="label sm:col-span-3"><span>Terms (printed on every proposal and signed agreement)</span>
          <textarea name="terms" rows={10} className="input font-mono text-xs" defaultValue={s.terms} />
        </label>
        <label className="label"><span>NJ HIC registration number</span>
          <input name="hicNumber" className="input" defaultValue={s.hicNumber ?? ""} />
        </label>
        <label className="label"><span>Prices good for (days)</span>
          <input name="validDays" type="number" min={1} max={365} className="input" defaultValue={s.validDays} />
        </label>
        <button className="btn self-end sm:justify-self-start">Save terms</button>
      </form>
    </section>
  );
}
