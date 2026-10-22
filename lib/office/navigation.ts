export type NavItem = { href: string; label: string; badge?: number | null };
export const workspaces = [
  { id: 'home', href: '/office', label: 'Home' },
  { id: 'roofing', href: '/office/leads', label: 'Roofing' },
  { id: 'subs', href: '/office/subs', label: 'Subcontracting' },
  { id: 'dumpsters', href: '/office/dumpsters', label: 'Dumpsters' },
] as const;
export type Workspace = typeof workspaces[number]['id'];
export const sections: Record<Workspace, NavItem[]> = {
  home: [],
  roofing: [{ href: '/office/leads', label: 'Leads' }, { href: '/office/jobs', label: 'Jobs' }, { href: '/office/stock', label: 'Stock' }, { href: '/office/referrals', label: 'Referrals' }],
  subs: [{ href: '/office/subs', label: 'Jobs' }, { href: '/office/subs/payroll', label: 'Crew Pay' }, { href: '/office/subs/invoices', label: 'Invoices' }, { href: '/office/subs/setup', label: 'Setup' }],
  dumpsters: [{ href: '/office/dumpsters', label: 'Dispatch' }, { href: '/office/requests', label: 'Requests' }, { href: '/office/cans', label: 'Cans' }, { href: '/office/billing', label: 'Billing' }],
};
export const utilities: NavItem[] = [{ href: '/office/inbox', label: 'Inbox' }, { href: '/office/customers', label: 'Customers' }, { href: '/office/numbers', label: 'Reporting' }, { href: '/office/settings', label: 'Settings' }];
export function within(path: string, root: string) { return path === root || path.startsWith(`${root}/`); }
export function workspaceFor(path: string): Workspace | null {
  if (path === '/office') return 'home';
  if (within(path, '/office/subs')) return 'subs';
  if (['leads', 'jobs', 'proposals', 'stock', 'referrals'].some(p => within(path, `/office/${p}`))) return 'roofing';
  if (['dumpsters', 'requests', 'rentals', 'cans', 'billing', 'pricing'].some(p => within(path, `/office/${p}`))) return 'dumpsters';
  return null;
}
export function sectionActive(path: string, href: string) {
  if (href === '/office/subs') return path === href || /^\/office\/subs\/(?!payroll(?:\/|$)|setup(?:\/|$)|invoices(?:\/|$))[^/]+/.test(path);
  if (href === '/office/leads' && within(path, '/office/proposals')) return true;
  if (href === '/office/dumpsters' && within(path, '/office/rentals')) return true;
  return within(path, href);
}
