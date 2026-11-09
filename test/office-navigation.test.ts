import { describe, expect, it } from 'vitest';
import {
  jobsBadge, primary, primaryFor, sectionActive, sectionBadge, sections, utilities, workspaceBadge, workspaceFor, workspaces,
} from '@/lib/office/navigation';
import { subQuery } from '@/lib/subcontract/navigation';

describe('office workspace routes', () => {
  it.each([
    ['/office', null], ['/office/leads/abc/estimate', 'roofing'], ['/office/proposals/abc', 'roofing'],
    ['/office/jobs/abc', 'roofing'], ['/office/stock', 'roofing'], ['/office/referrals', 'roofing'],
    ['/office/subs/abc', 'subs'], ['/office/subs/payroll', 'subs'], ['/office/subs/invoices', 'subs'],
    ['/office/rentals/abc', 'dumpsters'], ['/office/billing/abc', 'dumpsters'], ['/office/requests', 'dumpsters'],
    ['/office/dumpsters', 'dumpsters'], ['/office/cans', 'dumpsters'], ['/office/pricing', 'dumpsters'],
    ['/office/settings', null], ['/office/inbox/123', null], ['/office/workspaces', null], ['/office/more', null],
    ['/driver', null], ['/crew', null], ['/office/substitute', null],
  ])('%s belongs to %s', (path, workspace) => expect(workspaceFor(path)).toBe(workspace));

  it('has four stable main destinations in the Figma order', () => {
    expect(primary.map(p => p.label)).toEqual(['Today', 'Jobs', 'Inbox', 'More']);
    expect(primary.map(p => p.href)).toEqual(['/office', '/office/workspaces', '/office/inbox', '/office/more']);
  });

  it('lists the three lines of business as workspaces', () => {
    expect(workspaces.map(w => w.label)).toEqual(['Roofing', 'Subcontracting', 'Dumpsters']);
    expect(utilities.map(u => u.label)).toEqual(['Customers', 'Reporting', 'Settings']);
  });

  it('starts every workspace on its first section', () => {
    for (const w of workspaces) expect(sections[w.id][0].href).toBe(w.href);
  });

  it.each([
    ['/office', 'today'], ['/office/inbox', 'inbox'], ['/office/inbox/123', 'inbox'],
    ['/office/workspaces', 'jobs'], ['/office/leads/abc', 'jobs'], ['/office/subs/payroll', 'jobs'], ['/office/billing', 'jobs'],
    ['/office/more', 'more'], ['/office/customers/abc', 'more'], ['/office/numbers', 'more'], ['/office/settings', 'more'],
    ['/office/inboxes', null], ['/driver', null],
  ])('%s highlights %s in the main navigation', (path, id) => expect(primaryFor(path)).toBe(id));

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

describe('navigation badges', () => {
  const badges = { leads: 3, requests: 2, inbox: 5 };
  it('puts new leads on Roofing and pending requests on Dumpsters', () => {
    expect(workspaceBadge('roofing', badges)).toBe(3);
    expect(workspaceBadge('dumpsters', badges)).toBe(2);
    expect(workspaceBadge('subs', badges)).toBeNull();
    expect(sectionBadge('/office/leads', badges)).toBe(3);
    expect(sectionBadge('/office/requests', badges)).toBe(2);
    expect(sectionBadge('/office/jobs', badges)).toBeNull();
  });
  it('sums Jobs from what loaded and hides an empty or unknown total', () => {
    expect(jobsBadge(badges)).toBe(5);
    expect(jobsBadge({ leads: null, requests: 2, inbox: null })).toBe(2);
    expect(jobsBadge({ leads: 0, requests: 0, inbox: 0 })).toBeNull();
    expect(jobsBadge({ leads: null, requests: null, inbox: null })).toBeNull();
  });
});
