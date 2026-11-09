"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandLogo } from "@/app/_components/brand";
import { Icon, type IconName } from "@/app/_ui/icon";
import {
  jobsBadge, primary, primaryFor, sectionActive, sectionBadge, sections, utilities, within,
  workspaceBadge, workspaceFor, workspaces, type NavBadges, type Primary,
} from "@/lib/office/navigation";

const ICONS: Record<Primary, IconName> = { today: "calendar-days", jobs: "briefcase-business", inbox: "inbox", more: "ellipsis" };

function primaryBadge(id: Primary, badges: NavBadges): { value: number | null; label: string } {
  if (id === "inbox") return { value: badges.inbox, label: "unread" };
  if (id === "jobs") return { value: jobsBadge(badges), label: "new leads and requests" };
  return { value: null, label: "" };
}

/** Subcontracting keeps its selected week and filter when moving between its sections. */
function useLocalHref() {
  const query = useSearchParams();
  const week = query.get("week");
  const filter = query.get("filter");
  return (href: string) => {
    if (!href.startsWith("/office/subs")) return href;
    const params = new URLSearchParams();
    if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) params.set("week", week);
    if (filter === "scheduled" || filter === "done") params.set("filter", filter);
    return `${href}${params.size ? `?${params}` : ""}`;
  };
}

function Count({ value, label, className = "" }: { value: number | null | undefined; label: string; className?: string }) {
  if (!value) return null;
  return (
    <span className={`inline-flex min-w-6 justify-center rounded-full bg-accent px-1.5 text-xs leading-5 font-semibold text-accent-foreground ${className}`}>
      {value > 99 ? "99+" : value}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

/** Desktop sidebar (Figma V2): four destinations, then the workspaces with the current one expanded. */
export function Sidebar({ badges, name, role }: { badges: NavBadges; name: string; role: "owner" | "office" }) {
  const pathname = usePathname();
  const active = primaryFor(pathname);
  const workspace = workspaceFor(pathname);
  const localHref = useLocalHref();
  return (
    <aside className="hidden border-r border-border/60 bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-y-auto">
      <div className="flex flex-1 flex-col gap-5 p-5">
        <Link href="/office" className="block w-40">
          {/* The logo is navy: on the dark-mode surface it needs its white plate back. */}
          <BrandLogo plate={false} className="dark:rounded-md dark:bg-white dark:px-3 dark:py-2.5" />
        </Link>
        <nav aria-label="Main">
          <ul className="space-y-1">
            {primary.map((item) => {
              const on = active === item.id;
              const badge = primaryBadge(item.id, badges);
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-row px-2.5 text-[15px] font-semibold ${on ? "bg-ok-soft" : "hover:bg-sunken"}`}
                  >
                    <Icon name={ICONS[item.id]} className={on ? "text-ok" : "text-muted"} />
                    {item.label}
                    <Count value={badge.value} label={badge.label} className="ml-auto" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <nav aria-label="Workspaces">
          <p className="eyebrow px-2.5">Workspaces</p>
          <ul className="mt-2 space-y-0.5">
            {workspaces.map((w) => {
              const on = workspace === w.id;
              return (
                <li key={w.id}>
                  <Link
                    href={w.href}
                    aria-current={on ? "true" : undefined}
                    className={`flex min-h-10 items-center gap-2 rounded-row px-2.5 text-sm ${on ? "font-semibold" : "font-medium text-muted hover:bg-sunken hover:text-foreground"}`}
                  >
                    {w.label}
                    <Count value={workspaceBadge(w.id, badges)} label="new" className="ml-auto" />
                  </Link>
                  {on && (
                    <ul className="mt-0.5 mb-2 ml-2.5 space-y-0.5 border-l border-border pl-2">
                      {sections[w.id].map((s) => {
                        const current = sectionActive(pathname, s.href);
                        return (
                          <li key={s.href}>
                            <Link
                              href={localHref(s.href)}
                              aria-current={current ? "page" : undefined}
                              className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm ${current ? "bg-ok-soft font-semibold text-ok" : "text-muted hover:text-foreground"}`}
                            >
                              {s.label}
                              <Count value={sectionBadge(s.href, badges)} label="new" className="ml-auto" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {utilities.map((u) => {
              const on = within(pathname, u.href);
              return (
                <li key={u.href}>
                  <Link
                    href={u.href}
                    aria-current={on ? "page" : undefined}
                    className={`flex min-h-10 items-center rounded-row px-2.5 text-sm ${on ? "font-semibold" : "font-medium text-muted hover:bg-sunken hover:text-foreground"}`}
                  >
                    {u.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto space-y-0.5 border-t border-border/60 px-2.5 pt-4 text-sm">
          <p className="font-semibold break-words">{name}</p>
          <p className="text-xs text-muted">{role === "owner" ? "Owner" : "Office"}</p>
          {/* A div, not a p: a form inside a <p> is invalid HTML and breaks hydration. */}
          <div className="flex gap-3 pt-2 text-muted">
            <Link href="/driver" className="hover:text-foreground hover:underline">Driver view</Link>
            <form action="/auth/signout" method="post">
              <button className="hover:text-foreground hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Phone tab bar: the same four destinations, always in the same place. */
export function TabBar({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();
  const active = primaryFor(pathname);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid grid-cols-4">
        {primary.map((item) => {
          const on = active === item.id;
          const badge = primaryBadge(item.id, badges);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${on ? "font-semibold text-accent" : "text-muted"}`}
              >
                <span className="relative">
                  <Icon name={ICONS[item.id]} size={22} />
                  <Count value={badge.value} label={badge.label} className="absolute -top-2 left-3.5" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phones: the current workspace's sections as a scrolling strip above the page. */
export function LocalNav({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();
  const workspace = workspaceFor(pathname);
  const localHref = useLocalHref();
  if (!workspace) return null;
  const label = workspaces.find((w) => w.id === workspace)?.label ?? "";
  return (
    <nav aria-label={`${label} sections`} className="-mx-4 overflow-x-auto px-4 lg:hidden">
      <div className="flex w-max items-center gap-2">
        <span className="pr-1 text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
        <ul className="flex gap-2">
          {sections[workspace].map((s) => {
            const on = sectionActive(pathname, s.href);
            return (
              <li key={s.href}>
                <Link
                  href={localHref(s.href)}
                  aria-current={on ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-row border px-3.5 text-sm font-semibold whitespace-nowrap ${on ? "border-transparent bg-ok-soft text-ok" : "border-border/60 bg-surface text-muted"}`}
                >
                  {s.label}
                  <Count value={sectionBadge(s.href, badges)} label="new" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
