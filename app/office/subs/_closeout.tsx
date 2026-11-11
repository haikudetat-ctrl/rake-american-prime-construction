'use client';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { completeSubJob } from './actions';
import { Callout } from '@/app/_ui/callout';
import { ConsequenceReview } from '@/app/_ui/consequence-review';
import { MoneyForm } from '@/app/_ui/money-form';
import { closeoutReview, staleSummary, type FingerprintPart, type Rate, type ReviewExtra } from '@/lib/subcontract/review';
import { formatCents } from '@/lib/money';

function EditButton({ onEdit }: { onEdit: () => void }) {
  const { pending } = useFormStatus();
  return <button type="button" className="btn-secondary sm:justify-self-start" disabled={pending} onClick={onEdit}>Edit squares / pitch</button>;
}

/**
 * Finish a subcontract job (Figma 35 to 36, 85). The review is computed here from what the
 * page loaded; `fingerprint` is what the database fingerprinted before that load, and the
 * close is refused if crew, extras, rates or the contractor changed since. When that happens
 * the page comes back with `stale` set and the squares and pitch filled in, straight into a
 * fresh review.
 */
export function Closeout({ jobId, contractor, email, weekly = false, crew, extras, billRate, crewRate, returnQuery, fingerprint, recheckHref, stale, initial }: {
  jobId: string; contractor: string; email: string | null; weekly?: boolean; crew: { id: string; name: string }[];
  extras: ReviewExtra[]; billRate: Rate; crewRate: Rate; returnQuery: string;
  fingerprint: string; recheckHref: string; stale: FingerprintPart[] | null; initial: { squares: string; pitch: string } | null;
}) {
  const [squares, setSquares] = useState(initial?.squares ?? '');
  const [pitch, setPitch] = useState(initial?.pitch ?? '');
  const [reviewing, setReviewing] = useState(Boolean(stale && initial));
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (reviewing && !stale) reviewHeading.current?.focus(); }, [reviewing, stale]);
  const gutterOnly = squares !== '' && Number(squares) === 0;
  const result = closeoutReview(Number(squares), Number(pitch || 0), billRate, crewRate, extras, crew.length);
  const scope = gutterOnly ? 'Gutters and extras, no squares' : `${squares} squares · ${pitch}/12 pitch`;
  const recipient = email?.trim();
  return <div className="space-y-3">
    {stale && <Callout tone="warning" role="alert" title="Work changed during review">
      {staleSummary(stale)} Nothing was invoiced. The numbers below are current: check them and finish again.
    </Callout>}
    {!reviewing ? <form onSubmit={event => { event.preventDefault(); setReviewing(true); }} className="grid grid-cols-2 gap-3">
      <label className="label"><span>Squares</span><input type="number" min="0" max="999" step="0.01" required value={squares} onChange={e => setSquares(e.target.value)} className="input" /></label>
      <label className="label"><span>Pitch (x/12)</span><input type="number" min="0" max="24" step="1" required={!gutterOnly} value={pitch} onChange={e => setPitch(e.target.value)} className="input" /></label>
      {gutterOnly && <p className="col-span-2 text-xs text-muted">0 squares: a gutter or extras-only job. No pitch needed, and no minimum applies.</p>}
      <button className="btn col-span-2">Review closeout</button>
    </form> : <section aria-labelledby={`review-${jobId}`} className="space-y-4">
      <h3 id={`review-${jobId}`} ref={reviewHeading} tabIndex={-1} className="font-semibold">Review before finishing</h3>
      <p className="text-sm">{scope} · {contractor}</p>
      {result.payCents > result.billCents && <Callout tone="warning" title="Crew pay is more than the bill">
        The crew earns {formatCents(result.payCents - result.billCents)} more than {contractor} is billed on this job. Check the squares, the extras and the contractor&apos;s rates before you finish.
      </Callout>}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-row border border-border/60 bg-surface p-3 text-sm sm:p-4">
        {/* Extras span both columns so their longer detail never squeezes the amounts. */}
        {extras.map((e, i) => <div key={i} className="col-span-2 flex flex-wrap justify-between gap-x-3 text-muted"><dt>{e.description} × {e.qty}</dt><dd>bill {formatCents(e.bill_unit_cents)} · crew {formatCents(e.pay_unit_cents)} each</dd></div>)}
        {extras.length === 0 && <><dt className="text-muted">Extras</dt><dd className="text-right text-muted">None</dd></>}
        {result.minimumCents > 0 && <><dt className="text-muted">Minimum job charge top-up</dt><dd className="text-right text-muted">{formatCents(result.minimumCents)}</dd></>}
        <dt className="font-semibold">Contractor bill</dt><dd className="text-right font-semibold">{formatCents(result.billCents)}</dd>
        <dt className="font-semibold">Crew pay earned</dt><dd className="text-right font-semibold">{formatCents(result.payCents)}</dd>
        {crew.map((c, i) => <div key={c.id} className="contents text-muted"><dt className="pl-3">{c.name}</dt><dd className="text-right">{formatCents(result.share + (i < result.remainder ? 1 : 0))}</dd></div>)}
      </dl>
      <p className="text-xs text-muted">Shares split evenly; leftover cents go to the first names alphabetically. The database stores the final figures when you confirm.</p>
      <MoneyForm action={completeSubJob} recheckHref={recheckHref} className="grid gap-3">
        <input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="returnQuery" value={returnQuery} />
        <input type="hidden" name="squares" value={squares} /><input type="hidden" name="pitch" value={gutterOnly ? '0' : pitch} />
        <input type="hidden" name="fingerprint" value={fingerprint} />
        <ConsequenceReview
          effects={[
            weekly
              ? `Invoice for ${formatCents(result.billCents)} to ${contractor}. Nothing is emailed now: it goes on their weekly statement with the week's other jobs.`
              : recipient
                ? `Invoice for ${formatCents(result.billCents)} to ${contractor}, emailed to ${recipient} 15 minutes after you confirm. An owner can reopen the job before then to stop the email.`
                : `Invoice for ${formatCents(result.billCents)} to ${contractor}. No billing email on file, so nothing is emailed; the invoice is ready to download.`,
            `${formatCents(result.payCents)} crew pay recorded as earned this week, split ${crew.length} ${crew.length === 1 ? 'way' : 'ways'}. This does not record paying anyone.`,
            gutterOnly
              ? 'The job closes with no squares (gutters and extras only). Changing that later needs an owner to reopen it.'
              : `The job closes at ${squares} squares and ${pitch}/12. Changing that later needs an owner to reopen it.`,
          ]}
          acknowledgment="I checked the squares, pitch, crew and extras."
          submitLabel="Finish job and issue invoice"
          pendingLabel="Finishing job…"
        />
        <EditButton onEdit={() => setReviewing(false)} />
      </MoneyForm>
    </section>}
  </div>;
}
