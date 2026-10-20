"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number | null };

function isActive(pathname: string, href: string) {
  return href === "/office" ? pathname === "/office" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Office section links; vertical in the sidebar, a scrolling strip on small screens. */
export function OfficeNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap ${
              active ? "bg-ink-active text-white" : "text-ink-foreground/85 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span>{item.label}</span>
            {item.badge ? (
              <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-foreground">{item.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
