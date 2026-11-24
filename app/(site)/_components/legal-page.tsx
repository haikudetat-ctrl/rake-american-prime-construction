import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, SkipLink, siteNav } from "@/app/(site)/_components/chrome";
import s from "../site.module.css";

/** Shared frame for the Privacy Policy and Terms: company header, one reading column, the usual footer. */
export function LegalPage({ title, effective, children }: { title: string; effective: string; children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <SiteHeader brand="company" nav={siteNav()} />
      <main id="main">
        <article className={`${s.wrap} ${s.legal}`}>
          <h1>{title}</h1>
          <p className={s.legalMeta}>Effective {effective}</p>
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
