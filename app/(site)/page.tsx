import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import roofingLogo from "@/public/brand/ap-roofing-logo.png";
import dropwiseLogo from "@/public/brand/dropwise-logo-white.png";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "@/app/(site)/_components/chrome";
import {
  COMPANY_NAME,
  DROPWISE_NAME,
  HIC_NUMBER,
  PATHS,
  REQUEST_HREF,
  ROOFING_NAME,
  WORKMANSHIP_WARRANTY_YEARS,
  canonicalUrl,
} from "@/lib/site/config";
import s from "./site.module.css";

export const metadata: Metadata = {
  title: `${COMPANY_NAME} | Roofing and dumpster rentals near Atlantic City`,
  description:
    "Roof replacement, repairs and gutters from AP Roofing & Gutters, roll-off dumpster rentals from DropWise, and labor-only roofing crews for contractors in the Atlantic City area.",
  alternates: { canonical: canonicalUrl("company") },
  robots: { index: true, follow: true },
  openGraph: {
    title: COMPANY_NAME,
    description: "Roofing, gutters and roll-off dumpster rentals in the Atlantic City area.",
    url: canonicalUrl("company"),
    siteName: COMPANY_NAME,
    type: "website",
  },
};

const nav = [
  { href: PATHS.roofing, label: "Roofing" },
  { href: PATHS.dumpster, label: "Dumpsters" },
  { href: PATHS.contractors, label: "For contractors" },
  { href: "/login", label: "Team sign in" },
];

export default function CompanyHome() {
  return (
    <>
      <SkipLink />
      <SiteHeader brand="company" nav={nav} />
      <main id="main">
        <section className={`${s.wrap} ${s.hubHero}`} aria-labelledby="hub-title">
          <h1 id="hub-title" className={s.display}>
            Roofing and dumpster rentals near Atlantic City.
          </h1>
          <p className={`${s.lede} ${s.muted}`}>
            {COMPANY_NAME} installs and repairs roofs as {ROOFING_NAME}, rents roll-off dumpsters as
            DropWise, and supplies roofing crews to other contractors. Pick what you need.
          </p>
        </section>

        <div className={s.doors}>
          <section className={`${s.door} ${s.white}`} aria-labelledby="door-roofing">
            <div className={`${s.wrap} ${s.doorInner}`}>
              <div className={s.doorMark}>
                <Image src={roofingLogo} alt={ROOFING_NAME} className={s.doorLogo} />
              </div>
              <div className={s.doorText}>
                <h2 id="door-roofing" className={s.h2}>Roof replacement, repairs and gutters</h2>
                <p className={s.muted}>
                  GAF shingle systems, a written proposal you sign online, and a{" "}
                  {WORKMANSHIP_WARRANTY_YEARS}-year workmanship warranty on every roof we install.
                </p>
              </div>
              <div className={s.doorActions}>
                <Link href={REQUEST_HREF.roofing} prefetch={false} className={s.btn}>
                  Get a roofing estimate
                </Link>
                <Link href={PATHS.roofing} className={s.btnGhost}>
                  Roofing services
                </Link>
              </div>
            </div>
          </section>

          <section className={`${s.door} ${s.dark}`} aria-labelledby="door-dumpsters">
            <div className={`${s.wrap} ${s.doorInner}`}>
              <div className={s.doorMark}>
                <Image src={dropwiseLogo} alt={DROPWISE_NAME} className={s.doorLogo} />
              </div>
              <div className={s.doorText}>
                <h2 id="door-dumpsters" className={s.h2}>Roll-off dumpster rentals</h2>
                <p className={s.muted}>
                  10, 15 and 20-yard dumpsters for cleanouts, renovations and roof tear-offs. Request one
                  online and we confirm availability and the details with you.
                </p>
              </div>
              <div className={s.doorActions}>
                <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.btn}>
                  Request a dumpster
                </Link>
                <Link href={PATHS.dumpster} className={s.btnOnDark}>
                  Dumpster sizes
                </Link>
              </div>
            </div>
          </section>

          <section className={s.door} aria-labelledby="door-crews">
            <div className={`${s.wrap} ${s.doorInner}`}>
              <div className={s.doorMark}>
                <p className={s.doorLabel}>For roofing contractors</p>
              </div>
              <div className={s.doorText}>
                <h2 id="door-crews" className={s.h2}>Labor-only roofing crews</h2>
                <p className={s.muted}>
                  Send one job or your whole week. We supply the crew, you supply the materials, and
                  each job is invoiced when it&apos;s done.
                </p>
              </div>
              <div className={s.doorActions}>
                <Link href={PATHS.contractors} className={s.btnGhost}>
                  How it works
                </Link>
              </div>
            </div>
          </section>
        </div>

        <section className={`${s.wrap} ${s.sectionTight}`} aria-label={`About ${COMPANY_NAME}`}>
          <dl className={s.facts}>
            <div>
              <dt>Licensed in New Jersey</dt>
              <dd>Home Improvement Contractor #{HIC_NUMBER}</dd>
            </div>
            <div>
              <dt>Workmanship warranty</dt>
              <dd>{WORKMANSHIP_WARRANTY_YEARS} years on every roof we install</dd>
            </div>
            <div>
              <dt>Where we work</dt>
              <dd>The Atlantic City area. Send your address and we&apos;ll confirm.</dd>
            </div>
          </dl>
        </section>
      </main>
      <SiteFooter />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: COMPANY_NAME,
          url: canonicalUrl("company"),
          logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/american-prime-construction.png`,
          brand: [
            { "@type": "Brand", name: ROOFING_NAME, url: canonicalUrl("roofing") },
            { "@type": "Brand", name: DROPWISE_NAME, url: canonicalUrl("dumpster") },
          ],
        }}
      />
    </>
  );
}
