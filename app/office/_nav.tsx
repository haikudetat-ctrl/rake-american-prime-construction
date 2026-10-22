"use client";
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { sections, utilities, workspaces, workspaceFor, sectionActive, type NavItem } from '@/lib/office/navigation';
export type { NavItem } from '@/lib/office/navigation';

export function OfficeNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const workspace = workspaceFor(pathname);
  const week = query.get('week');
  const filter = query.get('filter');
  function localHref(href: string) {
    if (!href.startsWith('/office/subs')) return href;
    const params = new URLSearchParams();
    if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) params.set('week', week);
    if (filter === 'scheduled' || filter === 'done') params.set('filter', filter);
    return `${href}${params.size ? `?${params}` : ''}`;
  }
  function secondary(item: NavItem) {
    const badge = items.find(i => i.href === item.href)?.badge;
    return <Link key={item.href} href={localHref(item.href)} aria-current={sectionActive(pathname, item.href) ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm ${sectionActive(pathname, item.href) ? 'bg-ink-active text-white' : 'text-ink-foreground hover:bg-white/5'}`}>
      {item.label}{badge ? <span className="rounded-full bg-accent px-2 text-xs text-accent-foreground">{badge}</span> : null}
    </Link>;
  }
  return <>
    <nav aria-label="Workspaces" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-ink-active bg-ink pb-[env(safe-area-inset-bottom)] shadow-lg lg:static lg:flex lg:flex-col lg:border-0 lg:pb-0 lg:shadow-none">
      {workspaces.map(item => <Link key={item.id} href={item.href} aria-current={workspace === item.id ? 'page' : undefined}
        className={`flex min-h-14 items-center justify-center px-1 py-3 text-[11px] font-semibold sm:text-sm lg:justify-start lg:rounded-md lg:px-3 ${workspace === item.id ? 'bg-ink-active text-white' : 'text-ink-foreground hover:bg-white/5'}`}>
        {item.label}
      </Link>)}
    </nav>
    {workspace && sections[workspace].length > 0 && <nav aria-label={`${workspace === 'subs' ? 'Subcontracting' : workspace} navigation`} className="flex flex-wrap gap-1 lg:mt-4 lg:flex-col lg:border-t lg:border-ink-active lg:pt-3">
      {sections[workspace].map(secondary)}
    </nav>}
    <nav aria-label="Office utilities" className="mt-2 flex flex-wrap gap-1 border-t border-ink-active pt-2 lg:mt-5 lg:flex-col">{utilities.map(secondary)}</nav>
  </>;
}
