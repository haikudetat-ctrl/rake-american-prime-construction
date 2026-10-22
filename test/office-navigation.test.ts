import { describe, expect, it } from 'vitest';
import { workspaceFor, sectionActive, workspaces } from '@/lib/office/navigation';
import { subQuery } from '@/lib/subcontract/navigation';
describe('office workspace routes', () => {
  it.each([
    ['/office', 'home'], ['/office/leads/abc/estimate', 'roofing'], ['/office/proposals/abc', 'roofing'],
    ['/office/jobs/abc', 'roofing'], ['/office/subs/abc', 'subs'], ['/office/subs/payroll', 'subs'],
    ['/office/subs/invoices', 'subs'], ['/office/rentals/abc', 'dumpsters'], ['/office/billing/abc', 'dumpsters'],
    ['/office/dumpsters', 'dumpsters'], ['/office/settings', null], ['/office/inbox/123', null], ['/driver', null], ['/crew', null], ['/office/substitute', null],
  ])('%s belongs to %s', (path, workspace) => expect(workspaceFor(path)).toBe(workspace));
  it('has exactly four stable destinations', () => expect(workspaces.map(w => w.label)).toEqual(['Home', 'Roofing', 'Subcontracting', 'Dumpsters']));
  it('does not mark Jobs selected on other subcontracting sections', () => {
    expect(sectionActive('/office/subs/abc', '/office/subs')).toBe(true);
    for (const path of ['payroll', 'setup', 'invoices']) expect(sectionActive(`/office/subs/${path}`, '/office/subs')).toBe(false);
  });
  it('maps proposal and rental details to their secondary context', () => {
    expect(sectionActive('/office/proposals/abc', '/office/leads')).toBe(true);
    expect(sectionActive('/office/rentals/abc', '/office/dumpsters')).toBe(true);
  });
  it('preserves only supported local navigation state', () => {
    expect(subQuery({ week: '2026-10-19', filter: 'scheduled' })).toBe('?week=2026-10-19&filter=scheduled');
    expect(subQuery({ week: '//evil.test', filter: 'unknown' })).toBe('');
    expect(subQuery({ week: ['2026-10-19'], filter: 'done' })).toBe('?filter=done');
  });
});
