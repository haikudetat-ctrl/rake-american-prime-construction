import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import companyLockup from "@/public/brand/american-prime-drive.png";
import dumpsterLogo from "@/public/brand/dropwise-logo.png";
import roofingWordmark from "@/public/brand/ap-roofing-wordmark.png";
import {
  COMPANY_NAME,
  DROPWISE_NAME,
  HIC_NUMBER,
  PATHS,
  REQUEST_HREF,
  ROOFING_NAME,
} from "@/lib/site/config";
import s from "../site.module.css";
import { MobileMenu } from "./mobile-menu";

type NavItem = { href: string; label: string; current?: boolean };

const LOGOS: Record<"company" | "roofing" | "dumpster", { src: StaticImageData; alt: string; height: number; href: string }> = {
  company: { src: companyLockup, alt: COMPANY_NAME, height: 62, href: PATHS.company },
  dumpster: { src: dumpsterLogo, alt: DROPWISE_NAME, height: 58, href: PATHS.dumpster },
  roofing: { src: roofingWordmark, alt: ROOFING_NAME, height: 34, href: PATHS.roofing },
};

export function SkipLink() {
  return (
    <a href="#main" className={s.skip}>
      Skip to content
    </a>
  );
}

export function SiteHeader({
  brand,
  nav,
  cta,
}: {
  brand: "company" | "roofing" | "dumpster";
  nav: NavItem[];
  cta?: { href: string; label: string };
}) {
  const logo = LOGOS[brand];
  return (
    <header className={s.header}>
      <div className={`${s.wrap} ${s.headerInner}`}>
        <Link href={logo.href} className={s.brandLink} aria-label={`${logo.alt} home`}>
          <div><Image src={logo.src} alt={logo.alt} style={{ height: logo.height }} preload />{brand !== "company" && <span className={s.brandName}>An American Prime company</span>}</div>
        </Link>
        <nav aria-label="Main" className={s.nav}>
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        {cta && (
          <Link href={cta.href} prefetch={false} className={`${s.btn} ${s.headerCta}`}>
            {cta.label}
          </Link>
        )}
        <MobileMenu nav={nav} cta={cta} />
      </div>
    </header>
  );
}

/** Shared by all three brands, so every page links to the other businesses. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={s.footer}>
      <div className={s.wrap}>
        <div className={s.footerGrid}>
          <div>
            <Link href={PATHS.company} aria-label={`${COMPANY_NAME} home`}><Image src={companyLockup} alt={COMPANY_NAME} className={s.footerLogo} /></Link>
            <p>
              {ROOFING_NAME} and {DROPWISE_NAME} are services of {COMPANY_NAME}.
            </p>
            <p style={{ marginTop: 12 }}>NJ Home Improvement Contractor #{HIC_NUMBER}</p>
          </div>
          <div>
            <h2>Roofing</h2>
            <ul>
              <li><Link href={REQUEST_HREF.roofing} prefetch={false}>Get a roofing estimate</Link></li>
              <li><Link href={PATHS.roofing}>Roofing and gutters</Link></li>
              <li><Link href={PATHS.contractors}>Crews for contractors</Link></li>
            </ul>
          </div>
          <div>
            <h2>Dumpsters</h2>
            <ul>
              <li><Link href={REQUEST_HREF.dumpster} prefetch={false}>Request a dumpster</Link></li>
              <li><Link href={`${PATHS.dumpster}#sizes`}>Dumpster sizes</Link></li>
            </ul>
          </div>
          <div>
            <h2>Company</h2>
            <ul>
              <li><Link href={PATHS.company}>{COMPANY_NAME}</Link></li>
              <li><Link href="/login" prefetch={false}>Team sign in</Link></li>
            </ul>
          </div>
        </div>
        <div className={s.footerBottom}>
          <span>© {year} {COMPANY_NAME}</span>
          <span>Hamilton to Atlantic City & surrounding areas</span>
        </div>
      </div>
    </footer>
  );
}

/** Structured data for search engines. Content is static, built on the server. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is escaped for "<" so the block cannot close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
