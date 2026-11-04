"use client";

import Link from "next/link";
import s from "../site.module.css";

export function MobileMenu({ nav, cta }: {
  nav: { href: string; label: string; current?: boolean }[];
  cta?: { href: string; label: string };
}) {
  return <details className={s.menu}
    onClick={(event) => {
      if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false;
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}>
    <summary>Menu</summary>
    <nav aria-label="Mobile navigation" className={s.menuPanel}>
      {nav.map(item => <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>{item.label}</Link>)}
      {cta && <Link href={cta.href} prefetch={false} className={s.btn}>{cta.label}</Link>}
    </nav>
  </details>;
}
