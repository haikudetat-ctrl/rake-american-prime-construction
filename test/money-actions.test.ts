import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  rpc: vi.fn(),
  rpcResult: { data: 'invoice-1', error: null } as { data: unknown; error: unknown },
}));
vi.mock('@/lib/auth', () => ({
  requireStaff: async () => ({ role: 'owner', userId: 'user-1', companyId: 'company-1', name: 'Sample Owner' }),
  requireOwner: async () => ({ role: 'owner', userId: 'user-1', companyId: 'company-1', name: 'Sample Owner' }),
  getMember: async () => ({ role: 'owner', userId: 'user-1', companyId: 'company-1', name: 'Sample Owner' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: (name: string, args: unknown) => { fx.rpc(name, args); return Promise.resolve(fx.rpcResult); },
    from: () => {
      const chain: Record<string, unknown> = { single: async () => ({ data: { number: 41, total_cents: 301000, sub_contractors: { billing_email: null } } }) };
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      return chain;
    },
  }),
}));

import * as office from '@/app/office/actions';
import * as subs from '@/app/office/subs/actions';
import { Closeout } from '@/app/office/subs/_closeout';
import { ConfirmAction } from '@/app/_ui/confirm-action';
import { runMoneyAction } from '@/app/_ui/money-form';
import { parseFingerprint, parseStale, staleSummary } from '@/lib/subcontract/review';

const FP = { crew: 'a', extras: 'b', rates: 'c', contractor: 'd' };
function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const closeout = (extra: Record<string, string> = {}) =>
  form({ jobId: 'job-1', returnQuery: '?week=2026-11-09', squares: '20', pitch: '6', fingerprint: JSON.stringify(FP), acknowledged: 'yes', ...extra });

beforeEach(() => {
  fx.rpc.mockReset();
  fx.rpcResult = { data: 'invoice-1', error: null };
});

describe('closeout fingerprint helpers', () => {
  it('accepts only a complete fingerprint', () => {
    expect(parseFingerprint(JSON.stringify(FP))).toEqual(FP);
    expect(parseFingerprint('{"crew":"a"}')).toBeNull();
    expect(parseFingerprint('not json')).toBeNull();
    expect(parseFingerprint('["a"]')).toBeNull();
  });
  it('reads only known parts from the stale query', () => {
    expect(parseStale('rates,crew,bogus')).toEqual(['crew', 'rates']);
    expect(parseStale(undefined)).toBeNull();
    expect(parseStale(['crew'])).toBeNull();
  });
  it('names what changed in plain words', () => {
    expect(staleSummary(['crew'])).toBe('The crew changed after you opened the review.');
    expect(staleSummary(['crew', 'extras', 'rates'])).toBe('The crew, the extras and the billing or crew rates changed after you opened the review.');
    expect(staleSummary([])).toBe('Something on this job changed after you opened the review.');
  });
});

describe('closing a subcontract job', () => {
  it('sends the reviewed fingerprint with the close', async () => {
    await expect(subs.completeSubJob(closeout())).rejects.toThrow('redirect:/office/subs/job-1?week=2026-11-09&notice=');
    expect(fx.rpc).toHaveBeenCalledWith('complete_sub_job', { p_job_id: 'job-1', p_squares: 20, p_pitch: 6, p_expected_fingerprint: FP });
  });

  it('returns to a fresh review naming what changed when the work changed (screen 85)', async () => {
    fx.rpcResult = { data: null, error: { message: 'work changed during review', hint: 'stale_review', details: 'crew,extras' } };
    await expect(subs.completeSubJob(closeout())).rejects.toThrow(
      'redirect:/office/subs/job-1?week=2026-11-09&stale=crew%2Cextras&squares=20&pitch=6#finish',
    );
  });

  it('refuses a close without the review fingerprint or the acknowledgment', async () => {
    await expect(subs.completeSubJob(closeout({ fingerprint: '' }))).rejects.toThrow('error=Reload+the+job');
    await expect(subs.completeSubJob(closeout({ acknowledged: '' }))).rejects.toThrow('error=Tick+the+box');
    expect(fx.rpc).not.toHaveBeenCalled();
  });
});

describe('every void and cancel needs its acknowledgment', () => {
  it.each([
    ['void subcontract payment', () => subs.voidSubPayment(form({ jobId: 'job-1', paymentId: 'p', reason: 'x' }))],
    ['reopen subcontract job', () => subs.reopenSubJob(form({ jobId: 'job-1', reason: 'x' }))],
    ['cancel subcontract job', () => subs.cancelSubJob(form({ jobId: 'job-1' }))],
    ['issue statements', () => office.issueStatementsNow(form({}))],
    ['void statement', () => office.voidStatement(form({ statementId: 's', reason: 'x' }))],
    ['void dumpster invoice', () => office.voidInvoice(form({ rentalId: 'r', invoiceId: 'i', reason: 'x' }))],
    ['cancel rental', () => office.cancelRental(form({ rentalId: 'r' }))],
    ['void job cost', () => office.voidJobCost(form({ jobId: 'j', costId: 'c', reason: 'x' }))],
    ['void job payment', () => office.voidJobPayment(form({ jobId: 'j', paymentId: 'p', reason: 'x' }))],
    ['void referral', () => office.voidReferral(form({ referralId: 'r', reason: 'x' }))],
  ])('%s is refused without it', async (_name, run) => {
    await expect(run()).rejects.toThrow('error=Tick+the+box');
    expect(fx.rpc).not.toHaveBeenCalled();
  });

  it('goes through once acknowledged', async () => {
    await expect(office.voidStatement(form({ statementId: 's', reason: 'x', acknowledged: 'yes' }))).rejects.toThrow('redirect:/office/billing/s?notice=');
    expect(fx.rpc).toHaveBeenCalledWith('void_statement', { p_statement_id: 's', p_reason: 'x' });
  });
});

describe('uncertain outcomes (screen 84)', () => {
  it('lets a redirect through to the router', async () => {
    const { redirect } = await vi.importActual<typeof import('next/navigation')>('next/navigation');
    await expect(runMoneyAction(async () => redirect('/office/billing'), form({}))).rejects.toThrow();
  });
  it('reports a dropped connection as uncertain, never as failed', async () => {
    expect(await runMoneyAction(async () => { throw new TypeError('Failed to fetch'); }, form({}))).toBe('uncertain');
    expect(await runMoneyAction(async () => undefined, form({}))).toBe('done');
  });
});

describe('review screens', () => {
  const props = {
    jobId: 'job-1', contractor: 'Example GC', email: 'ap@example.com', crew: [{ id: 'w1', name: 'Avery' }, { id: 'w2', name: 'Blake' }],
    extras: [], billRate: { base: 9500, from: 9, step: 500 }, crewRate: { base: 5000, from: 9, step: 500 }, returnQuery: '',
    fingerprint: JSON.stringify(FP), recheckHref: '/office/subs/job-1#finish',
  };
  it('opens straight into a fresh review after a stale close, with what changed', () => {
    const html = renderToStaticMarkup(createElement(Closeout, { ...props, stale: ['crew'], initial: { squares: '20', pitch: '6' } }));
    expect(html).toContain('Work changed during review');
    expect(html).toContain('The crew changed after you opened the review. Nothing was invoiced.');
    expect(html).toContain('Finish job and issue invoice');
    expect(html).toContain('emailed to ap@example.com 15 minutes after you confirm');
    expect(html).toContain(`value="${JSON.stringify(FP).replaceAll('"', '&quot;')}"`);
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });
  it('starts a normal close at the squares and pitch step', () => {
    const html = renderToStaticMarkup(createElement(Closeout, { ...props, stale: null, initial: null }));
    expect(html).not.toContain('Work changed during review');
    expect(html).toContain('Review closeout');
  });
  it('shows only the button until someone opens the consequences', () => {
    const html = renderToStaticMarkup(createElement(ConfirmAction, {
      action: async () => undefined, trigger: 'Void statement', effects: ['It is voided.'], acknowledgment: 'Void it.', submitLabel: 'Void statement', recheckHref: '/office/billing/s',
    }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('<form');
  });
});
