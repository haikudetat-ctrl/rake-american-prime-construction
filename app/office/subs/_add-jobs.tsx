'use client';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addSubJobs, type AddJobsState } from './actions';
import { Callout } from '@/app/_ui/callout';
import { ConsequenceReview } from '@/app/_ui/consequence-review';
import { Submit } from '@/app/_ui/submit';
import { formatDate, weekStart } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { checkDraft, MAX_JOBS, splitAddresses, toPayload, type ContractorOption, type DraftCheck, type DraftJob } from '@/lib/subcontract/add-jobs';
import type { Rate } from '@/lib/subcontract/review';
import { unitLabel } from '@/lib/subcontract/tiers';

type Worker = { id: string; name: string };

/**
 * Add jobs: one in the morning, a contractor's whole week, or the ones that
 * never got put in. A job typed with its squares closes as it's added (same
 * invoice and crew pay as finishing it from its page); without them it's
 * scheduled. Line items come from the job's contractor's price list.
 *
 * Everything stays in the form until the database takes the whole list, so a
 * refused job is fixed in place instead of typed again.
 */
export function AddJobs({ contractors, workers, crewRate, today, defaultDate }: {
  contractors: ContractorOption[]; workers: Worker[]; crewRate: Rate; today: string; defaultDate: string;
}) {
  const router = useRouter();
  // Keys only need to be unique within the form; the first is fixed so server and browser render it alike.
  const fresh = (from?: DraftJob, key = Math.random().toString(36).slice(2)): DraftJob => ({
    key,
    contractorId: from?.contractorId ?? (contractors.length === 1 ? contractors[0].id : ''),
    workDate: from?.workDate ?? defaultDate,
    address: '',
    notes: '',
    workerIds: from?.workerIds ?? [],
    squares: '',
    pitch: '',
    items: {},
  });
  const [jobs, setJobs] = useState<DraftJob[]>(() => [fresh(undefined, 'first')]);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [state, action] = useActionState<AddJobsState, FormData>(async (previous, form) => {
    const answer = await addSubJobs(previous, form);
    // Added: clear the form and show the week they went on, with the notice.
    if (answer?.ok) {
      setJobs([fresh()]);
      setPasting(false);
      setPasted('');
      router.push(answer.href);
    }
    return answer;
  }, null);

  const update = (key: string, change: Partial<DraftJob>) => setJobs((all) => all.map((j) => (j.key === key ? { ...j, ...change } : j)));
  const remove = (key: string) => setJobs((all) => (all.length > 1 ? all.filter((j) => j.key !== key) : all));
  const addOne = () => setJobs((all) => (all.length >= MAX_JOBS ? all : [...all, fresh(all.at(-1))]));
  const lines = splitAddresses(pasted);
  const addPasted = () => {
    const last = jobs.at(-1)!;
    // An untouched last job is the one the list was meant to fill.
    const keep = last.address.trim() === '' && last.squares === '' && Object.keys(last.items).length === 0 ? jobs.slice(0, -1) : jobs;
    const made = lines.slice(0, MAX_JOBS - keep.length).map((address) => ({ ...fresh(last), address }));
    setJobs([...keep, ...made]);
    setPasting(false);
    setPasted('');
  };

  const byId = new Map(contractors.map((c) => [c.id, c]));
  const checks = jobs.map((j) => checkDraft(j, byId.get(j.contractorId), crewRate, today));
  const payload = toPayload(jobs, contractors, crewRate, today);
  const closing = jobs.filter((_, i) => checks[i].state === 'close');
  const totals = checks.reduce((t, c) => (c.state === 'close' ? { bill: t.bill + c.billCents, pay: t.pay + c.payCents } : t), { bill: 0, pay: 0 });
  const earlier = closing.filter((j) => weekStart(j.workDate) < weekStart(today)).length;
  const perJob = closing.some((j) => byId.get(j.contractorId)?.weekly === false);
  const weekly = closing.some((j) => byId.get(j.contractorId)?.weekly);
  const scheduled = jobs.length - closing.length;
  const noun = jobs.length === 1 ? 'job' : `${jobs.length} jobs`;
  const refused = state && !state.ok ? state : null;
  const firstInvalid = checks.findIndex((c) => c.state === 'invalid');

  return (
    <form action={action} className="space-y-4">
      {/* Empty only while a required field is blank, which the browser stops before posting. */}
      <input type="hidden" name="jobs" value={'jobs' in payload ? JSON.stringify(payload.jobs) : ''} />
      {refused && (
        <Callout tone="danger" title="Nothing was added">
          {refused.error}{refused.job ? <> <a className="underline" href={`#add-job-${refused.job}`}>Go to job {refused.job}</a></> : null}
        </Callout>
      )}

      {jobs.map((job, i) => (
        <JobCard key={job.key} n={i + 1} job={job} check={checks[i]} contractors={contractors} workers={workers}
          flagged={refused?.job === i + 1} removable={jobs.length > 1}
          onChange={(change) => update(job.key, change)} onRemove={() => remove(job.key)} />
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={addOne} disabled={jobs.length >= MAX_JOBS}>+ Another job</button>
        <button type="button" className="btn-secondary" aria-expanded={pasting} onClick={() => setPasting((p) => !p)}>Paste a list of addresses</button>
      </div>
      {pasting && (
        <div className="space-y-2 rounded-row border border-border/60 p-3 sm:p-4">
          <label className="label">
            <span>Addresses, one a line</span>
            <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} className="input" placeholder={'14 Elm St, Cherry Hill\n220 Kings Hwy, Haddonfield'} />
          </label>
          <p className="text-xs text-muted">
            Each line becomes a job with job {jobs.length}&apos;s day, contractor and crew. Change any of them after.
          </p>
          <button type="button" className="btn-secondary" disabled={lines.length === 0} onClick={addPasted}>
            {lines.length ? `Make ${lines.length} ${lines.length === 1 ? 'job' : 'jobs'}` : 'Make jobs'}
          </button>
        </div>
      )}

      {firstInvalid >= 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-warn">Job {firstInvalid + 1} needs a fix before anything is added.</p>
          <button className="btn w-full sm:w-auto" disabled>Add {noun}</button>
        </div>
      ) : closing.length > 0 ? (
        <ConsequenceReview
          title="When you add these"
          effects={[
            `${closing.length === jobs.length ? (jobs.length === 1 ? 'It closes' : `All ${jobs.length} close`) : `${closing.length} of ${jobs.length} close`} now: ${formatCents(totals.bill)} billed, ${formatCents(totals.pay)} crew pay recorded.`,
            ...(weekly ? ['Invoices for contractors billed weekly go on their next statement.'] : []),
            ...(perJob ? ['Invoices for contractors billed per job email 15 minutes later, so a mistake can still be fixed by reopening.'] : []),
            ...(earlier ? [`${earlier === 1 && closing.length === 1 ? 'It was' : `${earlier} were`} worked before this week. That crew pay counts on ${earlier === 1 ? "that week's" : "those weeks'"} earnings, which may already be paid out.`] : []),
            ...(scheduled ? [`${scheduled} ${scheduled === 1 ? 'stays' : 'stay'} scheduled to finish later.`] : []),
          ]}
          acknowledgment="I checked the days, squares, pitch, crew and line items."
          submitLabel={`Add ${noun}`}
          pendingLabel="Adding…"
        />
      ) : (
        <Submit className="btn w-full sm:w-auto" pendingLabel="Adding…">Add {noun}</Submit>
      )}
    </form>
  );
}

function JobCard({ n, job, check, contractors, workers, flagged, removable, onChange, onRemove }: {
  n: number; job: DraftJob; check: DraftCheck; contractors: ContractorOption[]; workers: Worker[];
  flagged: boolean; removable: boolean; onChange: (change: Partial<DraftJob>) => void; onRemove: () => void;
}) {
  const contractor = contractors.find((c) => c.id === job.contractorId);
  const items = contractor?.items ?? [];
  const picked = Object.keys(job.items).length;
  const toggleWorker = (id: string) =>
    onChange({ workerIds: job.workerIds.includes(id) ? job.workerIds.filter((w) => w !== id) : [...job.workerIds, id] });
  const toggleItem = (id: string, on: boolean) => {
    const next = { ...job.items };
    if (on) next[id] = '';
    else delete next[id];
    onChange({ items: next });
  };
  const id = (field: string) => `job-${job.key}-${field}`;
  return (
    <section id={`add-job-${n}`} aria-labelledby={id('title')}
      className={`scroll-mt-4 space-y-3 rounded-row border p-3 sm:p-4 ${flagged ? 'border-danger' : 'border-border/60'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={id('title')} className="text-sm font-semibold">Job {n}</h3>
        {removable && <button type="button" className="text-xs underline" onClick={onRemove}>Remove</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="label">
          <span>Day</span>
          <input type="date" required value={job.workDate} onChange={(e) => onChange({ workDate: e.target.value })} className="input" />
        </label>
        <label className="label sm:col-span-2">
          <span>Contractor</span>
          {/* A different contractor means a different price list, so picks don't carry over. */}
          <select required value={job.contractorId} onChange={(e) => onChange({ contractorId: e.target.value, items: {} })} className="input">
            <option value="" disabled>Pick one</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="label">
        <span>Address</span>
        <input required autoComplete="off" value={job.address} onChange={(e) => onChange({ address: e.target.value })} placeholder="232 Hewitt St, Trenton" className="input" />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Crew</legend>
        <div className="flex flex-wrap gap-2">
          {workers.map((w) => (
            <button key={w.id} type="button" aria-pressed={job.workerIds.includes(w.id)} onClick={() => toggleWorker(w.id)}
              className="min-h-11 rounded-md border border-border px-3 py-2 text-sm aria-pressed:border-brand aria-pressed:bg-sunken aria-pressed:font-semibold">
              {w.name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="label">
          <span>Squares</span>
          <input inputMode="decimal" value={job.squares} onChange={(e) => onChange({ squares: e.target.value })} placeholder="When done" className="input" />
        </label>
        <label className="label">
          <span>Pitch (x/12)</span>
          <input inputMode="numeric" value={job.pitch} onChange={(e) => onChange({ pitch: e.target.value })} className="input" />
        </label>
        <label className="label col-span-2">
          <span>Notes (optional)</span>
          <input value={job.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Gate code, layers, who's leading…" className="input" />
        </label>
      </div>
      {items.length > 0 && (
        <details className="rounded-row border border-border/60 bg-surface">
          <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-medium">
            Line items from {contractor!.name}&apos;s price list{picked ? ` (${picked} picked)` : ''}
          </summary>
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {items.map((item) => {
              const on = item.id in job.items;
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" checked={on} onChange={(e) => toggleItem(item.id, e.target.checked)} className="size-5 shrink-0" />
                    <span>
                      {item.description}
                      <span className="block text-xs text-muted">
                        {formatCents(item.billCents)} {unitLabel(item.unit)} · crew {formatCents(item.payCents)}
                      </span>
                    </span>
                  </label>
                  {on && (
                    <input aria-label={`How many ${item.description}`} inputMode="decimal" autoFocus value={job.items[item.id]}
                      onChange={(e) => onChange({ items: { ...job.items, [item.id]: e.target.value } })}
                      placeholder={item.unit === 'ft' ? 'Feet' : 'How many'} className="input w-24" />
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <Outcome check={check} contractor={contractor} crew={job.workerIds.length} workDate={job.workDate} />
    </section>
  );
}

function Outcome({ check, contractor, crew, workDate }: { check: DraftCheck; contractor?: ContractorOption; crew: number; workDate: string }) {
  if (check.state === 'invalid') return <p role="status" className="text-sm text-warn">{check.message}</p>;
  if (check.state === 'open') {
    return <p className="text-xs text-muted">Stays scheduled. Fill in squares and pitch to close it now and bill {contractor?.name ?? 'the contractor'}.</p>;
  }
  const each = crew > 1 ? ` (${formatCents(check.share)}${check.remainder ? '+' : ''} each)` : '';
  return (
    <p role="status" className="text-sm">
      <span className="font-semibold">Closes on add:</span> bills {contractor?.name} {formatCents(check.billCents)}
      {check.minimumCents > 0 && <> (includes the {formatCents(check.minimumCents)} minimum top-up)</>} · crew {formatCents(check.payCents)}{each}
      {' '}· {formatDate(workDate)}
      {check.payCents > check.billCents && <span className="block text-warn">Crew pay is more than the bill. Check the squares and line items.</span>}
    </p>
  );
}
