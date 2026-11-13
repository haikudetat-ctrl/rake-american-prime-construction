'use client';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addRentals, type AddRentalsState } from './actions';
import { Callout } from '@/app/_ui/callout';
import { ConsequenceReview } from '@/app/_ui/consequence-review';
import { Submit } from '@/app/_ui/submit';
import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import {
  checkRental, MAX_RENTALS, splitAddresses, STATE_LABEL, toPayload,
  type DraftRental, type RentalCheck, type RentalContext, type RentalState,
} from '@/lib/rentals/add-rentals';

type Landfill = { id: string; name: string };
const STATES: RentalState[] = ['scheduled', 'on_site', 'done'];
const UNIT_LABEL: Record<string, string> = { each: 'each', day: 'a day', ton: 'a ton', hour: 'an hour', trip: 'a trip' };

/** "It's final and goes on…", "They're final and go on…", "2 are final and go on…". */
function finishedText(finished: number, billed: number): string {
  if (finished === billed) return billed === 1 ? "It's final and goes on the customer's next statement." : "They're final and go on the customers' next statements.";
  return `${finished} ${finished === 1 ? 'is' : 'are'} final and ${finished === 1 ? 'goes' : 'go'} on the next statement.`;
}

/**
 * Add rentals: a booking, a contractor's list of jobs, or rentals nobody
 * recorded. A rental is booked (goes on the run), out on the job (its can
 * leaves the yard and its invoice opens), or picked up and dumped (billed in
 * full, on the next statement). Charges come from the owner's price list.
 *
 * Everything stays in the form until the database takes the whole list, so a
 * refused rental is fixed in place instead of typed again.
 */
export function AddRentals({ context, landfills, defaultDate }: { context: RentalContext; landfills: Landfill[]; defaultDate: string }) {
  const router = useRouter();
  const sitesOf = (customerId: string) => context.customers.find((c) => c.id === customerId)?.sites ?? [];
  // Keys only need to be unique within the form; the first is fixed so server and browser render it alike.
  const fresh = (from?: DraftRental, key = Math.random().toString(36).slice(2)): DraftRental => {
    const customerId = from?.customerId ?? (context.customers.length === 1 ? context.customers[0].id : '');
    return {
      key, customerId, siteId: sitesOf(customerId)[0]?.id ?? 'new', address: '',
      state: from?.state ?? 'scheduled', dropDate: from?.dropDate ?? defaultDate, canId: '',
      pickedUpOn: from?.pickedUpOn ?? '', tons: '', dumpFee: '', ticket: '', landfillId: from?.landfillId ?? '', notes: '', items: {},
    };
  };
  const [rentals, setRentals] = useState<DraftRental[]>(() => [fresh(undefined, 'first')]);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [state, action] = useActionState<AddRentalsState, FormData>(async (previous, form) => {
    const answer = await addRentals(previous, form);
    // Added: clear the form and show the day they went on, with the notice.
    if (answer?.ok) {
      setRentals([fresh()]);
      setPasting(false);
      setPasted('');
      router.push(answer.href);
    }
    return answer;
  }, null);

  const update = (key: string, change: Partial<DraftRental>) => setRentals((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const remove = (key: string) => setRentals((all) => (all.length > 1 ? all.filter((r) => r.key !== key) : all));
  const addOne = () => setRentals((all) => (all.length >= MAX_RENTALS ? all : [...all, fresh(all.at(-1))]));
  const lines = splitAddresses(pasted);
  const addPasted = () => {
    const last = rentals.at(-1)!;
    // An untouched last rental is the one the list was meant to fill.
    const untouched = last.siteId === 'new' && last.address.trim() === '' && Object.keys(last.items).length === 0;
    const keep = untouched ? rentals.slice(0, -1) : rentals;
    const made = lines.slice(0, MAX_RENTALS - keep.length).map((address) => ({ ...fresh(last), siteId: 'new', address }));
    setRentals([...keep, ...made]);
    setPasting(false);
    setPasted('');
  };

  const checks = rentals.map((r) => checkRental(r, context));
  const payload = toPayload(rentals, context);
  const billed = checks.filter((c): c is Extract<RentalCheck, { state: 'billed' }> => c.state === 'billed');
  const total = billed.reduce((s, c) => s + c.totalCents, 0);
  const finished = billed.filter((c) => c.final).length;
  const stillOut = rentals.filter((r, i) => checks[i].state === 'billed' && r.state === 'on_site');
  const booked = rentals.length - billed.length;
  const noun = rentals.length === 1 ? 'rental' : `${rentals.length} rentals`;
  const refused = state && !state.ok ? state : null;
  const firstInvalid = checks.findIndex((c) => c.state === 'invalid');
  const canLabel = (id: string) => context.cans.find((c) => c.id === id)?.label ?? '';

  return (
    <form action={action} className="space-y-4">
      {/* Empty only while a required field is blank, which the browser stops before posting. */}
      <input type="hidden" name="rentals" value={'rentals' in payload ? JSON.stringify(payload.rentals) : ''} />
      {refused && (
        <Callout tone="danger" title="Nothing was added">
          {refused.error}{refused.rental ? <> <a className="underline" href={`#add-rental-${refused.rental}`}>Go to rental {refused.rental}</a></> : null}
        </Callout>
      )}

      {rentals.map((r, i) => (
        <RentalCard key={r.key} n={i + 1} draft={r} check={checks[i]} context={context} landfills={landfills}
          flagged={refused?.rental === i + 1} removable={rentals.length > 1}
          onChange={(change) => update(r.key, change)} onRemove={() => remove(r.key)} />
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={addOne} disabled={rentals.length >= MAX_RENTALS}>+ Another rental</button>
        <button type="button" className="btn-secondary" aria-expanded={pasting} onClick={() => setPasting((p) => !p)}>Paste a list of addresses</button>
      </div>
      {pasting && (
        <div className="space-y-2 rounded-row border border-border/60 p-3 sm:p-4">
          <label className="label">
            <span>Addresses, one a line</span>
            <textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} className="input" placeholder={'14 Elm St, Cherry Hill\n220 Kings Hwy, Haddonfield'} />
          </label>
          <p className="text-xs text-muted">Each line becomes a rental with rental {rentals.length}&apos;s customer, day and status. Change any of them after.</p>
          <button type="button" className="btn-secondary" disabled={lines.length === 0} onClick={addPasted}>
            {lines.length ? `Make ${lines.length} ${lines.length === 1 ? 'rental' : 'rentals'}` : 'Make rentals'}
          </button>
        </div>
      )}

      {firstInvalid >= 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-warn">Rental {firstInvalid + 1} needs a fix before anything is added.</p>
          <button className="btn w-full sm:w-auto" disabled>Add {noun}</button>
        </div>
      ) : billed.length > 0 ? (
        <ConsequenceReview
          title="When you add these"
          effects={[
            `${billed.length === 1 ? 'An invoice opens' : `${billed.length} invoices open`} for ${formatCents(total)} in all.${finished ? ` ${finishedText(finished, billed.length)}` : ''}`,
            ...(stillOut.length ? [`Can ${stillOut.map((r) => canLabel(r.canId)).join(', ')} ${stillOut.length === 1 ? 'leaves' : 'leave'} the yard in Rake. Pickup and dump go through the driver as usual and add the extra days and disposal then.`] : []),
            'Rentals entered this way have no drop or pickup photos. Their history says the office recorded them.',
            ...(booked ? [`${booked} ${booked === 1 ? 'drop goes' : 'drops go'} on the run, unassigned.`] : []),
          ]}
          acknowledgment="I checked the days, cans, scale tickets and charges."
          submitLabel={`Add ${noun}`}
          pendingLabel="Adding…"
        />
      ) : (
        <Submit className="btn w-full sm:w-auto" pendingLabel="Adding…">Add {noun}</Submit>
      )}
    </form>
  );
}

function RentalCard({ n, draft, check, context, landfills, flagged, removable, onChange, onRemove }: {
  n: number; draft: DraftRental; check: RentalCheck; context: RentalContext; landfills: Landfill[];
  flagged: boolean; removable: boolean; onChange: (change: Partial<DraftRental>) => void; onRemove: () => void;
}) {
  const customer = context.customers.find((c) => c.id === draft.customerId);
  const sites = customer?.sites ?? [];
  const dropped = draft.state !== 'scheduled';
  const picked = Object.keys(draft.items).length;
  const id = (field: string) => `rental-${draft.key}-${field}`;
  const toggleItem = (itemId: string, on: boolean) => {
    const next = { ...draft.items };
    if (on) next[itemId] = '';
    else delete next[itemId];
    onChange({ items: next });
  };
  // On the job: only cans Rake has in the yard. Done: any can, since it's back by now.
  const cans = draft.state === 'on_site' ? context.cans.filter((c) => c.inYard) : context.cans;
  return (
    <section id={`add-rental-${n}`} aria-labelledby={id('title')}
      className={`scroll-mt-4 space-y-3 rounded-row border p-3 sm:p-4 ${flagged ? 'border-danger' : 'border-border/60'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={id('title')} className="text-sm font-semibold">Rental {n}</h3>
        {removable && <button type="button" className="text-xs underline" onClick={onRemove}>Remove</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">
          <span>Customer</span>
          <select required value={draft.customerId} className="input"
            onChange={(e) => onChange({ customerId: e.target.value, siteId: context.customers.find((c) => c.id === e.target.value)?.sites[0]?.id ?? 'new' })}>
            <option value="" disabled>Pick one</option>
            {context.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="label">
          <span>Address</span>
          <select value={draft.siteId} onChange={(e) => onChange({ siteId: e.target.value })} className="input" disabled={!customer}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.address}</option>)}
            <option value="new">New address…</option>
          </select>
        </label>
      </div>
      {draft.siteId === 'new' && (
        <label className="label">
          <span>New address</span>
          <input required autoComplete="off" value={draft.address} onChange={(e) => onChange({ address: e.target.value })} placeholder="14 Elm St, Cherry Hill" className="input" />
        </label>
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Where it stands</legend>
        <div className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <button key={s} type="button" aria-pressed={draft.state === s} onClick={() => onChange({ state: s, ...(s === 'scheduled' ? { items: {} } : {}) })}
              className="min-h-11 rounded-md border border-border px-3 py-2 text-sm aria-pressed:border-brand aria-pressed:bg-sunken aria-pressed:font-semibold">
              {STATE_LABEL[s]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="label">
          <span>{dropped ? 'Dropped' : 'Drop day'}</span>
          <input type="date" required value={draft.dropDate} onChange={(e) => onChange({ dropDate: e.target.value })} className="input" />
        </label>
        {dropped && (
          <label className="label">
            <span>Can</span>
            <select value={draft.canId} onChange={(e) => onChange({ canId: e.target.value })} className="input" required={draft.state === 'on_site'}>
              <option value="">{draft.state === 'done' ? 'Not sure' : 'Pick one'}</option>
              {cans.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.sizeYards} yd</option>)}
            </select>
          </label>
        )}
        {draft.state === 'done' && (
          <label className="label">
            <span>Picked up</span>
            <input type="date" required value={draft.pickedUpOn} onChange={(e) => onChange({ pickedUpOn: e.target.value })} className="input" />
          </label>
        )}
      </div>
      {draft.state === 'done' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="label">
            <span>Tons</span>
            <input required inputMode="decimal" value={draft.tons} onChange={(e) => onChange({ tons: e.target.value })} placeholder="2.4" className="input" />
          </label>
          <label className="label">
            <span>Dump fee ($)</span>
            <input required inputMode="decimal" value={draft.dumpFee} onChange={(e) => onChange({ dumpFee: e.target.value })} placeholder="182.50" className="input" />
          </label>
          <label className="label">
            <span>Ticket # (optional)</span>
            <input value={draft.ticket} onChange={(e) => onChange({ ticket: e.target.value })} className="input" />
          </label>
          {landfills.length > 0 && (
            <label className="label">
              <span>Landfill</span>
              <select value={draft.landfillId} onChange={(e) => onChange({ landfillId: e.target.value })} className="input">
                <option value="">Not sure</option>
                {landfills.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <label className="label">
        <span>Notes{dropped ? '' : ' for the driver'} (optional)</span>
        <input value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Driveway, left side…" className="input" />
      </label>
      {dropped && context.items.length > 0 && (
        <details className="rounded-row border border-border/60 bg-surface">
          <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-medium">
            Extra charges from the price list{picked ? ` (${picked} picked)` : ''}
          </summary>
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {context.items.map((item) => {
              const on = item.id in draft.items;
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" checked={on} onChange={(e) => toggleItem(item.id, e.target.checked)} className="size-5 shrink-0" />
                    <span>{item.description}<span className="block text-xs text-muted">{formatCents(item.unitCents)} {UNIT_LABEL[item.unit] ?? item.unit}</span></span>
                  </label>
                  {on && (
                    <input aria-label={`How many ${item.description}`} inputMode="decimal" autoFocus value={draft.items[item.id]}
                      onChange={(e) => onChange({ items: { ...draft.items, [item.id]: e.target.value } })} placeholder="How many" className="input w-24" />
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <Outcome check={check} draft={draft} customer={customer?.name} />
    </section>
  );
}

function Outcome({ check, draft, customer }: { check: RentalCheck; draft: DraftRental; customer?: string }) {
  if (check.state === 'invalid') return <p role="status" className="text-sm text-warn">{check.message}</p>;
  if (check.state === 'scheduled') {
    return <p className="text-xs text-muted">Goes on the run for {draft.dropDate ? formatDate(draft.dropDate) : 'its day'}, unassigned. Billing starts when the driver drops it.</p>;
  }
  return (
    <p role="status" className="text-sm">
      <span className="font-semibold">{check.final ? `Bills ${customer ?? 'the customer'}` : 'Opens an invoice for'} {formatCents(check.totalCents)}:</span>{' '}
      {check.lines.map((l) => `${l.label} ${formatCents(l.cents)}`).join(' · ')}
      <span className="block text-xs text-muted">
        Price book v{check.book.version}, in force on the drop day.{check.final ? '' : ' Extra days and disposal are added at pickup and dump.'}
      </span>
    </p>
  );
}
