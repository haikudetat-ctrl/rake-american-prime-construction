import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const fixture = vi.hoisted(() => ({ failed: new Set<string>(), populated: false, from: vi.fn(), staff: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireStaff: fixture.staff }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ from: fixture.from }) }));
import HomePage from '@/app/office/page';
import SubsPage from '@/app/office/subs/page';
beforeEach(() => {
  fixture.failed.clear(); fixture.populated = false; fixture.staff.mockReset();
  fixture.staff.mockResolvedValue({ role: 'office' });
  fixture.from.mockImplementation((table: string) => {
    const failed = fixture.failed.has(table);
    const data = fixture.populated && ['roofing_jobs', 'sub_jobs'].includes(table) ? [{ id: 'synthetic', address: '123 Example Street', status: 'scheduled', work_date: '2026-10-22' }] : [];
    const result = { data: failed ? null : data, count: failed ? null : 0, error: failed ? { code: 'PGRST205', message: 'Missing relation' } : null };
    const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'eq', 'neq', 'lt', 'lte', 'gte', 'order', 'limit']) chain[method] = () => chain;
    return chain;
  });
});
const props = () => ({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
describe('office data states', () => {
  it('renders empty today states with explicit business labels', async () => {
    const html = renderToStaticMarkup(await HomePage(props()));
    expect(html).toContain('Nothing scheduled today.');
    expect(html).toContain('Dumpster invoices ready');
    expect(html).toContain('Overdue subcontract invoices');
    expect(html).not.toContain('all-business total');
  });
  it('renders synthetic job deep links in both business workspaces', async () => {
    fixture.populated = true;
    const html = renderToStaticMarkup(await HomePage(props()));
    expect(html).toContain('/office/jobs/synthetic');
    expect(html).toContain('/office/subs/synthetic');
  });
  it('keeps the rest of Home usable when subcontracting schema is missing', async () => {
    fixture.failed.add('sub_jobs'); fixture.failed.add('sub_invoices');
    const html = renderToStaticMarkup(await HomePage(props()));
    expect(html).toContain('Unavailable');
    expect(html).toContain('subcontracting schema must be installed');
    expect(html).toContain('Open dispatch');
  });
  it('does not render zero earnings or mutation forms when subcontract data is unavailable', async () => {
    fixture.failed.add('sub_jobs');
    const html = renderToStaticMarkup(await SubsPage(props()));
    expect(html).toContain('Subcontracting unavailable');
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('<form');
  });
  it('preserves legacy dispatch date deep links and feedback', async () => {
    await expect(HomePage({ ...props(), searchParams: Promise.resolve({ date: '2026-10-20', notice: 'Saved' }) })).rejects.toThrow('redirect:/office/dumpsters?date=2026-10-20&notice=Saved');
  });
  it('checks staff before any business query', async () => {
    fixture.from.mockClear(); fixture.staff.mockRejectedValueOnce(new Error('redirect:/driver'));
    await expect(HomePage(props())).rejects.toThrow('redirect:/driver');
    expect(fixture.from).not.toHaveBeenCalled();
  });
});
