'use client';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveQuickInvoice, type SaveQuickInvoiceState } from './actions';
import { Callout } from '@/app/_ui/callout';
import { Submit } from '@/app/_ui/submit';
import { formatCents } from '@/lib/money';
import {
  defaultDueDate, invoiceTotals, lineAmount, MAX_LINES, parsePrice, parseQuantity, parseTaxPct, toPayload,
  type DraftInvoice, type DraftLine, type QuickInvoiceContext, type StoredItem,
} from '@/lib/billing/quick-invoice';

const UNIT_LABEL: Record<string, string> = { each: 'each', day: 'a day', ton: 'a ton', hour: 'an hour', trip: 'a trip', sq: 'a square', ft: 'a foot', sheet: 'a sheet' };
const CUSTOM = 'custom';

const freshLine = (key = Math.random().toString(36).slice(2)): DraftLine => ({ key, source: 'custom', itemId: '', description: '', quantity: '1', unit: '', price: '' });

/** The option value for a line's item: "custom", or "<source>:<id>" for a price list item. */
const itemValue = (l: Pick<DraftLine, 'source' | 'itemId'>) => (l.source === 'custom' || !l.itemId ? CUSTOM : `${l.source}:${l.itemId}`);

/**
 * Quick invoice: who it's for, what it's for, and the brand it goes out under.
 * Each line is a custom item (first in the list) or one picked from a price list
 * Rake already keeps, with its price filled in and still editable. Saving makes
 * a draft and opens its preview; nothing is issued or emailed from here.
 */
export function QuickInvoiceForm({ context, today, invoiceId, initial }: {
  context: QuickInvoiceContext; today: string; invoiceId?: string; initial?: DraftInvoice;
}) {
  const router = useRouter();
  const roofing = context.brands.find((b) => b.kind === 'roofing') ?? context.brands[0];
  const [draft, setDraft] = useState<DraftInvoice>(() => initial ?? {
    brandId: roofing?.id ?? '', fillFrom: '', name: '', email: '', phone: '', address: '',
    dueOn: defaultDueDate(today), taxPct: '', memo: '', lines: [freshLine('first')],
  });
  const [state, action] = useActionState<SaveQuickInvoiceState, FormData>(async (previous, form) => {
    const answer = await saveQuickInvoice(previous, form);
    if (answer?.ok) router.push(answer.href);
    return answer;
  }, null);

  const set = (change: Partial<DraftInvoice>) => setDraft((d) => ({ ...d, ...change }));
  const setLine = (key: string, change: Partial<DraftLine>) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...change } : l)) }));
  const removeLine = (key: string) => setDraft((d) => ({ ...d, lines: d.lines.length > 1 ? d.lines.filter((l) => l.key !== key) : d.lines }));
  const addLine = () => setDraft((d) => ({ ...d, lines: d.lines.length >= MAX_LINES ? d.lines : [...d.lines, freshLine()] }));

  const fillFrom = (value: string) => {
    const who = context.billTo.find((o) => o.value === value);
    if (!who) return set({ fillFrom: '' });
    set({
      fillFrom: value, name: who.name, email: who.email, phone: who.phone, address: who.address || draft.address,
      ...(who.termsDays !== null ? { dueOn: defaultDueDate(today, who.termsDays) } : {}),
    });
  };
  const pickItem = (line: DraftLine, value: string) => {
    if (value === CUSTOM) return setLine(line.key, { source: 'custom', itemId: '' });
    const [source, id] = value.split(':');
    const item = context.items.find((i) => i.source === source && i.id === id);
    if (!item) return;
    // The item's price fills in; it can still be changed for this invoice.
    setLine(line.key, { source: item.source, itemId: item.id, description: item.description, unit: item.unit, price: (item.unitCents / 100).toFixed(2) });
  };

  const checked = toPayload(draft);
  const preview = draft.lines.map((l) => {
    const q = parseQuantity(l.quantity);
    const p = parsePrice(l.price);
    return q !== null && p !== null ? lineAmount(q, p) : null;
  });
  const tax = parseTaxPct(draft.taxPct) ?? 0;
  const totals = invoiceTotals(
    draft.lines.flatMap((l) => {
      const q = parseQuantity(l.quantity);
      const p = parsePrice(l.price);
      return q !== null && p !== null ? [{ quantity: q, unitCents: p }] : [];
    }),
    tax,
  );
  const groups = [...new Set(context.items.map((i) => i.group))];
  const refused = state && !state.ok ? state : null;
  const pristine = !draft.name.trim() && draft.lines.every((l) => !l.description.trim() && !l.price.trim());
  const billToGroups = (['Customers', 'Contractors', 'Leads'] as const).filter((g) => context.billTo.some((o) => o.group === g));

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="invoice" value={checked.ok ? JSON.stringify(checked.payload) : ''} />
      {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
      {refused && <Callout tone="danger" title="Not saved yet">{refused.error}</Callout>}

      <section aria-labelledby="qi-who" className="card space-y-3">
        <h2 id="qi-who" className="font-semibold">Who it&apos;s for</h2>
        {context.billTo.length > 0 && (
          <label className="label">
            <span>Fill in from (optional)</span>
            <select value={draft.fillFrom} onChange={(e) => fillFrom(e.target.value)} className="input">
              <option value="">Type it in below</option>
              {billToGroups.map((g) => (
                <optgroup key={g} label={g}>
                  {context.billTo.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="label">
            <span>Name or company</span>
            <input required autoComplete="off" value={draft.name} onChange={(e) => set({ name: e.target.value })} className="input" placeholder="Pat Smith" />
          </label>
          <label className="label">
            <span>Email (optional)</span>
            <input type="email" autoComplete="off" value={draft.email} onChange={(e) => set({ email: e.target.value })} className="input" placeholder="pat@example.com" />
          </label>
          <label className="label">
            <span>Phone (optional)</span>
            <input type="tel" autoComplete="off" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} className="input" />
          </label>
          <label className="label">
            <span>Address (optional)</span>
            <input autoComplete="off" value={draft.address} onChange={(e) => set({ address: e.target.value })} className="input" placeholder="14 Elm St, Cherry Hill, NJ" />
          </label>
        </div>
      </section>

      <section aria-labelledby="qi-lines" className="space-y-3">
        <h2 id="qi-lines" className="text-base">Line items</h2>
        {draft.lines.map((l, i) => (
          <LineCard key={l.key} n={i + 1} line={l} amount={preview[i]} items={context.items} groups={groups}
            removable={draft.lines.length > 1} onPick={(v) => pickItem(l, v)} onChange={(c) => setLine(l.key, c)} onRemove={() => removeLine(l.key)} />
        ))}
        <button type="button" className="btn-secondary" onClick={addLine} disabled={draft.lines.length >= MAX_LINES}>+ Another line</button>
      </section>

      <section aria-labelledby="qi-terms" className="card space-y-3">
        <h2 id="qi-terms" className="font-semibold">Brand and terms</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="label">
            <span>Goes out as</span>
            <select required value={draft.brandId} onChange={(e) => set({ brandId: e.target.value })} className="input">
              {context.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="label">
            <span>Due</span>
            <input type="date" required min={today} value={draft.dueOn} onChange={(e) => set({ dueOn: e.target.value })} className="input" />
          </label>
          <label className="label">
            <span>Sales tax % (optional)</span>
            <input inputMode="decimal" value={draft.taxPct} onChange={(e) => set({ taxPct: e.target.value })} className="input" placeholder="None" />
          </label>
        </div>
        <label className="label">
          <span>Note on the invoice (optional)</span>
          <textarea rows={2} maxLength={2000} value={draft.memo} onChange={(e) => set({ memo: e.target.value })} className="input" placeholder="Work done at 14 Elm St on Nov 24." />
        </label>
      </section>

      <section aria-label="Total" className="card space-y-1 text-sm">
        {totals.taxCents > 0 && (
          <>
            <p className="flex justify-between"><span>Subtotal</span><span>{formatCents(totals.subtotalCents)}</span></p>
            <p className="flex justify-between"><span>Sales tax {tax}%</span><span>{formatCents(totals.taxCents)}</span></p>
          </>
        )}
        <p className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatCents(totals.totalCents)}</span></p>
      </section>

      {checked.ok ? (
        <div className="space-y-2">
          <Submit className="btn w-full sm:w-auto" pendingLabel="Saving…">Save draft and preview</Submit>
          <p className="text-xs text-muted">Saving makes a draft you can check as a PDF. Nothing goes to anyone until you issue it.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pristine
            ? <p className="text-sm text-muted">Add who it&apos;s for and a line, then save it as a draft to preview.</p>
            : <p className="text-sm text-warn">{checked.error}</p>}
          <button className="btn w-full sm:w-auto" disabled>Save draft and preview</button>
        </div>
      )}
    </form>
  );
}

function LineCard({ n, line, amount, items, groups, removable, onPick, onChange, onRemove }: {
  n: number; line: DraftLine; amount: number | null; items: StoredItem[]; groups: string[]; removable: boolean;
  onPick: (value: string) => void; onChange: (change: Partial<DraftLine>) => void; onRemove: () => void;
}) {
  const id = (field: string) => `line-${line.key}-${field}`;
  return (
    <section aria-labelledby={id('title')} className="space-y-3 rounded-row border border-border/60 p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={id('title')} className="text-sm font-semibold">Line {n}</h3>
        <span className="text-sm font-semibold">{amount === null ? '' : formatCents(amount)}</span>
      </div>
      <label className="label">
        <span>Item</span>
        <select value={itemValue(line)} onChange={(e) => onPick(e.target.value)} className="input">
          <option value={CUSTOM}>Custom item</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {items.filter((i) => i.group === g).map((i) => (
                <option key={`${i.source}:${i.id}`} value={`${i.source}:${i.id}`}>
                  {i.description} · {formatCents(i.unitCents)} {UNIT_LABEL[i.unit] ?? i.unit}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="label">
        <span>Description</span>
        <input required value={line.description} onChange={(e) => onChange({ description: e.target.value })} className="input" placeholder="Chimney flashing repair" maxLength={300} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="label">
          <span>Qty</span>
          <input required inputMode="decimal" value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} className="input" />
        </label>
        <label className="label">
          <span>Unit (optional)</span>
          <input value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} className="input" placeholder="ft, sq, hr" maxLength={20} />
        </label>
        <label className="label">
          <span>Price ($)</span>
          <input required inputMode="decimal" value={line.price} onChange={(e) => onChange({ price: e.target.value })} className="input" placeholder="450.00" />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{line.source === 'custom' ? 'A negative price makes it a credit.' : 'Price filled from the list; change it for this invoice if you need to.'}</span>
        {removable && <button type="button" className="underline" onClick={onRemove}>Remove line</button>}
      </div>
    </section>
  );
}
