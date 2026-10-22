'use client';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { completeSubJob } from './actions';
import { closeoutReview, type Rate, type ReviewExtra } from '@/lib/subcontract/review';
import { formatCents } from '@/lib/money';
function ReviewControls({ onEdit }: { onEdit: () => void }) {
  const { pending } = useFormStatus();
  return <div className="flex flex-wrap gap-2">
    <button type="button" className="btn-secondary" disabled={pending} onClick={onEdit}>Edit squares / pitch</button>
    <button className="btn min-h-11" disabled={pending}>{pending ? 'Finishing job…' : 'Confirm finish and issue invoice'}</button>
    {pending && <p role="status" className="text-sm">Saving closeout. Wait for confirmation before trying again.</p>}
  </div>;
}
export function Closeout({ jobId, contractor, email, crew, extras, billRate, crewRate, returnQuery }: {
  jobId: string; contractor: string; email: string | null; crew: { id: string; name: string }[];
  extras: ReviewExtra[]; billRate: Rate; crewRate: Rate; returnQuery: string;
}) {
  const [squares, setSquares] = useState('');
  const [pitch, setPitch] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (reviewing) reviewHeading.current?.focus(); }, [reviewing]);
  const result = closeoutReview(Number(squares), Number(pitch), billRate, crewRate, extras, crew.length);
  return <div className="space-y-3">
    {!reviewing ? <form onSubmit={event => { event.preventDefault(); setReviewing(true); }} className="grid grid-cols-2 gap-3">
      <label className="label"><span>Squares</span><input type="number" min="0.01" max="999" step="0.01" required value={squares} onChange={e => setSquares(e.target.value)} className="input py-3" /></label>
      <label className="label"><span>Pitch (x/12)</span><input type="number" min="0" max="24" step="1" required value={pitch} onChange={e => setPitch(e.target.value)} className="input py-3" /></label>
      <button className="btn col-span-2">Review closeout</button>
    </form> : <section aria-label="Review closeout" className="space-y-3" role="region">
      <h3 ref={reviewHeading} tabIndex={-1} className="font-semibold">Review before finishing</h3>
      <p>{squares} squares · {pitch}/12 pitch · {contractor}</p>
      <ul className="text-sm">{extras.length ? extras.map((e, i) => <li key={i}>{e.description} × {e.qty} · bill {formatCents(e.bill_unit_cents)} each · crew {formatCents(e.pay_unit_cents)} each</li>) : <li>No extras.</li>}</ul>
      <dl className="grid grid-cols-2 gap-2"><dt>Contractor bill</dt><dd className="text-right font-semibold">{formatCents(result.billCents)}</dd><dt>Crew pot earned</dt><dd className="text-right font-semibold">{formatCents(result.payCents)}</dd></dl>
      <p className="text-sm font-medium">Individual shares (database name / ID order)</p>
      <ul className="text-sm">{crew.map((c, i) => <li key={c.id}>{c.name} · {formatCents(result.share + (i < result.remainder ? 1 : 0))}</li>)}</ul>
      <p className="text-sm text-muted">Preview uses the rates and extras loaded with this page. Final shares are stored by the database when you confirm. Crew pay is earned; this does not record a worker payment.</p>
      <p className="rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">{email?.trim() ? `Invoice recipient: ${email}. Confirming queues an automatic email for 15 minutes after closeout. It may send later if delivery is delayed.` : 'No billing email on file. Confirming creates a downloadable invoice; no email is queued.'}</p>
      <form action={completeSubJob} className="space-y-3">
        <input type="hidden" name="jobId" value={jobId} /><input type="hidden" name="returnQuery" value={returnQuery} />
        <input type="hidden" name="squares" value={squares} /><input type="hidden" name="pitch" value={pitch} />
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" required />I reviewed the work, amounts, crew and email consequence.</label>
        <ReviewControls onEdit={() => setReviewing(false)} />
      </form>
    </section>}
  </div>;
}
