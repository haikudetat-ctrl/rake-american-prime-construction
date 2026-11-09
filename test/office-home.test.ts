import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const fixture = vi.hoisted(() => ({
  failed: new Set<string>(),
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  from: vi.fn(),
  staff: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireStaff: fixture.staff }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ from: fixture.from }) }));
import HomePage from '@/app/office/page';
import MorePage from '@/app/office/more/page';
import SubsPage from '@/app/office/subs/page';
import WorkspacesPage from '@/app/office/workspaces/page';

// Synthetic records only. "Today" is pinned to 2026-10-22 in the company's time zone.
const SYNTHETIC: Record<string, unknown[]> = {
  leads: [{ id: 'lead-1', name: 'Pat Example', address: '1 Example Road', area: null, need: 'repair', created_at: '2026-10-20T15:00:00Z' }],
  rental_requests: [{ id: 'req-1', contact_name: 'Sam Example', company_name: 'Example Builders', address: '2 Example Lane', requested_date: '2026-10-23' }],
  sub_jobs: [{ id: 'synthetic', address: '123 Example Street', status: 'scheduled', work_date: '2026-10-21', sub_contractors: { name: 'Example Roofing Co' } }],
  invoices: [
    { id: 'inv-1', total_cents: 45000, customer_id: 'cust-1', customers: { name: 'Example Builders' } },
    { id: 'inv-2', total_cents: 30000, customer_id: 'cust-1', customers: [{ name: 'Example Builders' }] },
  ],
  sub_invoices: [{
    id: 'si-1', job_id: 'synthetic', number: 7, total_cents: 100000, due_on: '2026-10-15', sub_contractors: { name: 'Example Roofing Co' },
    sub_payments: [{ amount_cents: 40000, voided_at: null }, { amount_cents: 50000, voided_at: '2026-10-16T12:00:00Z' }],
  }],
  proposals: [{ id: 'prop-1', number: 12, sent_at: '2026-10-10T15:00:00Z', viewed_at: null, leads: { name: 'Pat Example', address: '1 Example Road' } }],
  roofing_jobs: [{ id: 'synthetic', address: '9 Example Court', status: 'scheduled' }],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T16:00:00Z'));
  fixture.failed.clear(); fixture.rows = {}; fixture.counts = {}; fixture.staff.mockReset();
  fixture.staff.mockResolvedValue({ role: 'office', name: 'Office Example' });
  fixture.from.mockImplementation((table: string) => {
    const failed = fixture.failed.has(table);
    const data = fixture.rows[table] ?? [];
    const result = { data: failed ? null : data, count: failed ? null : (fixture.counts[table] ?? data.length), error: failed ? { code: 'PGRST205', message: 'Missing relation' } : null };
    const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'eq', 'neq', 'in', 'is', 'lt', 'lte', 'gte', 'order', 'limit']) chain[method] = () => chain;
    return chain;
  });
});
afterEach(() => vi.useRealTimers());
const props = () => ({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
const render = async () => renderToStaticMarkup(await HomePage(props()));

describe('Today', () => {
  it('says plainly when nothing needs review and nothing is scheduled', async () => {
    const html = await render();
    expect(html).toContain('Keep work moving');
    expect(html).toContain('Nothing needs review');
    expect(html).toContain('Nothing scheduled today.');
    expect(html).toContain('No stops still scheduled today.');
    expect(html).not.toContain('Dumpster invoices ready');
    expect(html).not.toContain('all-business total');
  });

  it('groups waiting work by queue, oldest first, with a deep link and next step for each', async () => {
    fixture.rows = SYNTHETIC;
    const html = await render();
    expect(html).toContain('6 items need a next step, oldest first.');
    for (const label of ['New roofing leads', 'Dumpster requests', 'Subcontract jobs to finish', 'Dumpster invoices ready', 'Overdue subcontract invoices', 'Proposals to follow up']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('/office/leads/lead-1');
    expect(html).toContain('Leak or repair · waiting 2 days');
    expect(html).toContain('/office/proposals/prop-1');
    expect(html).toContain('not opened yet');
    expect(html).toContain('Review &amp; finish');
    expect(html).toContain('Example Roofing Co · worked Wed, Oct 21, not finished');
    expect(html).not.toContain('Nothing needs review');
  });

  it('queues dumpster invoices per customer statement', async () => {
    fixture.rows = SYNTHETIC;
    const html = await render();
    expect(html).toContain('2 completed rentals ready · $750.00');
    expect(html.match(/>Example Builders<\/span>/g)).toHaveLength(1);
  });

  it('shows what is still owed on an overdue invoice, ignoring voided payments', async () => {
    fixture.rows = SYNTHETIC;
    const html = await render();
    expect(html).toContain('$600.00 due Thu, Oct 15 · 7 days overdue');
    expect(html).not.toContain('$1,000.00');
  });

  it('links to the full list when a queue has more than it shows', async () => {
    fixture.rows = SYNTHETIC; fixture.counts = { leads: 9 };
    const html = await render();
    expect(html).toContain('See all 9');
    expect(html).toContain('14 items need a next step');
  });

  it('renders synthetic job deep links in both business workspaces', async () => {
    fixture.rows = SYNTHETIC;
    const html = await render();
    expect(html).toContain('/office/jobs/synthetic');
    expect(html).toContain('/office/subs/synthetic');
  });

  it('reports failed queues as unknown, not zero, and keeps the rest usable', async () => {
    fixture.rows = SYNTHETIC; fixture.failed.add('sub_jobs'); fixture.failed.add('sub_invoices');
    const html = await render();
    expect(html).toContain('Some work is unavailable');
    expect(html).toContain('Subcontract jobs to finish, Overdue subcontract invoices could not load');
    expect(html).toContain('unknown, not zero');
    expect(html).toContain('At least 4 items need a next step.');
    expect(html).toContain('/office/leads/lead-1');
    expect(html).toContain('Unavailable. Reload to try again.');
    expect(html).toContain('Open dispatch');
    expect(html).not.toContain('Nothing needs review');
  });

  it('never claims there is nothing to do when every queue failed', async () => {
    for (const t of ['leads', 'rental_requests', 'sub_jobs', 'invoices', 'sub_invoices', 'proposals']) fixture.failed.add(t);
    const html = await render();
    expect(html).toContain('the total is unknown');
    expect(html).not.toContain('Nothing needs');
    expect(html).not.toContain('0 items');
  });

  it('preserves legacy dispatch date deep links and feedback', async () => {
    await expect(HomePage({ ...props(), searchParams: Promise.resolve({ date: '2026-10-20', notice: 'Saved' }) })).rejects.toThrow('redirect:/office/dumpsters?date=2026-10-20&notice=Saved');
  });
});

describe('Jobs and More', () => {
  it('lists each workspace with what is waiting in it', async () => {
    fixture.counts = { leads: 3, roofing_jobs: 1, sub_jobs: 4, sub_invoices: 0, rental_requests: 2, stops: 5 };
    const html = renderToStaticMarkup(await WorkspacesPage());
    expect(html).toContain('3 new leads · 1 open job');
    expect(html).toContain('4 scheduled jobs · 0 overdue invoices');
    expect(html).toContain('2 requests to review · 5 stops today');
    for (const href of ['/office/leads', '/office/subs', '/office/dumpsters']) expect(html).toContain(`href="${href}"`);
  });

  it('does not show a zero for a workspace count that failed', async () => {
    fixture.failed.add('sub_invoices');
    const html = renderToStaticMarkup(await WorkspacesPage());
    expect(html).toContain('Counts unavailable right now');
    expect(html).not.toContain('0 overdue invoices');
  });

  it('gathers office tools, field views and the account on More', async () => {
    const html = renderToStaticMarkup(await MorePage());
    for (const href of ['/office/customers', '/office/numbers', '/office/settings', '/driver', '/crew']) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('Office Example');
    expect(html).toContain('action="/auth/signout"');
    expect(fixture.from).not.toHaveBeenCalled();
  });
});

describe('office data states', () => {
  it('does not render zero earnings or mutation forms when subcontract data is unavailable', async () => {
    fixture.failed.add('sub_jobs');
    const html = renderToStaticMarkup(await SubsPage(props()));
    expect(html).toContain('Subcontracting unavailable');
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('<form');
  });

  it.each([
    ['Today', () => HomePage(props())],
    ['Jobs', () => WorkspacesPage()],
    ['More', () => MorePage()],
  ])('%s checks staff before any business query', async (_name, page) => {
    fixture.from.mockClear(); fixture.staff.mockRejectedValueOnce(new Error('redirect:/driver'));
    await expect(page()).rejects.toThrow('redirect:/driver');
    expect(fixture.from).not.toHaveBeenCalled();
  });
});
