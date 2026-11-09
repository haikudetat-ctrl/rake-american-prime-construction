export type NavItem = { href: string; label: string; badge?: number | null };

/**
 * Four destinations that never move (Figma V2 "Everyday work"): the bottom tab bar on
 * phones and the top of the sidebar on desktop. Jobs gathers the three business
 * workspaces; More holds the office pages that are not a workspace.
 */
export const primary = [
  { id: 'today', href: '/office', label: 'Today' },
  { id: 'jobs', href: '/office/workspaces', label: 'Jobs' },
  { id: 'inbox', href: '/office/inbox', label: 'Inbox' },
  { id: 'more', href: '/office/more', label: 'More' },
] as const;
export type Primary = typeof primary[number]['id'];

export const workspaces = [
  { id: 'roofing', href: '/office/leads', label: 'Roofing' },
  { id: 'subs', href: '/office/subs', label: 'Subcontracting' },
  { id: 'dumpsters', href: '/office/dumpsters', label: 'Dumpsters' },
] as const;
export type Workspace = typeof workspaces[number]['id'];

export const sections: Record<Workspace, NavItem[]> = {
  roofing: [{ href: '/office/leads', label: 'Leads' }, { href: '/office/jobs', label: 'Jobs' }, { href: '/office/stock', label: 'Stock' }, { href: '/office/referrals', label: 'Referrals' }],
  subs: [{ href: '/office/subs', label: 'Jobs' }, { href: '/office/subs/payroll', label: 'Crew Pay' }, { href: '/office/subs/invoices', label: 'Invoices' }, { href: '/office/subs/setup', label: 'Setup' }],
  dumpsters: [{ href: '/office/dumpsters', label: 'Dispatch' }, { href: '/office/requests', label: 'Requests' }, { href: '/office/cans', label: 'Cans' }, { href: '/office/billing', label: 'Billing' }],
};

/** Office pages outside the three workspaces. Listed in the desktop sidebar and on More. */
export const utilities: NavItem[] = [{ href: '/office/customers', label: 'Customers' }, { href: '/office/numbers', label: 'Reporting' }, { href: '/office/settings', label: 'Settings' }];

export function within(path: string, root: string) { return path === root || path.startsWith(`${root}/`); }

export function workspaceFor(path: string): Workspace | null {
  if (within(path, '/office/subs')) return 'subs';
  if (['leads', 'jobs', 'proposals', 'stock', 'referrals'].some(p => within(path, `/office/${p}`))) return 'roofing';
  if (['dumpsters', 'requests', 'rentals', 'cans', 'billing', 'pricing'].some(p => within(path, `/office/${p}`))) return 'dumpsters';
  return null;
}

/** Which of the four destinations a path belongs to. Every workspace page counts as Jobs. */
export function primaryFor(path: string): Primary | null {
  if (path === '/office') return 'today';
  if (within(path, '/office/inbox')) return 'inbox';
  if (within(path, '/office/workspaces') || workspaceFor(path)) return 'jobs';
  if (['more', 'customers', 'numbers', 'settings'].some(p => within(path, `/office/${p}`))) return 'more';
  return null;
}

export function sectionActive(path: string, href: string) {
  if (href === '/office/subs') return path === href || /^\/office\/subs\/(?!payroll(?:\/|$)|setup(?:\/|$)|invoices(?:\/|$))[^/]+/.test(path);
  if (href === '/office/leads' && within(path, '/office/proposals')) return true;
  if (href === '/office/dumpsters' && within(path, '/office/rentals')) return true;
  return within(path, href);
}

/** Badge counts the shell loads once per request. `null` means the count could not load. */
export type NavBadges = { requests: number | null; leads: number | null; inbox: number | null };

export function workspaceBadge(id: Workspace, badges: NavBadges): number | null {
  if (id === 'roofing') return badges.leads;
  if (id === 'dumpsters') return badges.requests;
  return null;
}

export function sectionBadge(href: string, badges: NavBadges): number | null {
  if (href === '/office/leads') return badges.leads;
  if (href === '/office/requests') return badges.requests;
  return null;
}

/** The Jobs tab shows new leads plus dumpster requests waiting for a decision. */
export function jobsBadge(badges: NavBadges): number | null {
  return (badges.leads ?? 0) + (badges.requests ?? 0) || null;
}
