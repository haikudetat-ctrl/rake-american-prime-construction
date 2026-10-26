import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "@/app/(site)/_components/chrome";
import { ContactLinks } from "@/app/(site)/_components/contact";
import { roofingNav } from "@/app/(site)/roofing/nav";
import { COMPANY_NAME, HIC_NUMBER, REQUEST_HREF, ROOFING_NAME, canonicalUrl } from "@/lib/site/config";
import { getSiteContent } from "@/lib/site/content";
import s from "../../site.module.css";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `Labor-only roofing crews for contractors | ${ROOFING_NAME}`,
  description:
    "Labor-only roofing crews for contractors in the Atlantic City area. Send one job or a week's schedule; each job is invoiced by email when it closes.",
  alternates: { canonical: canonicalUrl("contractors") },
  robots: { index: true, follow: true },
  openGraph: {
    title: `Roofing crews for contractors | ${ROOFING_NAME}`,
    description: "Labor-only roofing crews for contractors in the Atlantic City area.",
    url: canonicalUrl("contractors"),
    siteName: ROOFING_NAME,
    type: "website",
  },
};

export default async function ContractorsPage() {
  const { contacts } = await getSiteContent();
  const contact = contacts.roofing;
  const reachable = Boolean(contact.phone || contact.email);

  // Until the office saves a phone or email in Settings, the estimate form is
  // the one way in. It lands in Roofing Leads like any other request.
  const fallback = (
    <Link href={`${REQUEST_HREF.roofing}?need=other`} prefetch={false} className={s.btn}>
      Send us your details
    </Link>
  );

  return (
    <>
      <SkipLink />
      <SiteHeader
        brand="roofing"
        nav={roofingNav("contractors")}
        cta={{ href: REQUEST_HREF.roofing, label: "Get an estimate" }}
      />
      <main id="main">
        <section className={`${s.white} ${s.roofHero}`} aria-labelledby="gc-title">
          <div className={s.wrap}>
            <h1 id="gc-title" className={s.display} style={{ maxWidth: "15ch" }}>
              Roofing crews for contractors with more roofs than installers.
            </h1>
            <p className={`${s.lede} ${s.muted}`}>
              {ROOFING_NAME} supplies labor-only crews to roofing contractors in the Atlantic City area.
              You sell the job and have the materials delivered. We install it and invoice you per job.
            </p>
            <div className={s.actions}>{reachable ? <ContactLinks contact={contact} text /> : fallback}</div>
            {!reachable && (
              <p className={`${s.small} ${s.muted}`} style={{ marginTop: 12 }}>
                Choose &ldquo;Something else&rdquo; on the form and tell us you&apos;re a contractor.
              </p>
            )}
          </div>
        </section>

        <section className={`${s.wrap} ${s.section}`} aria-labelledby="gc-how-title">
          <div className={s.sectionHead}>
            <h2 id="gc-how-title" className={s.h2}>How a job runs</h2>
          </div>
          <ol className={s.steps} style={{ "--steps": 3 } as React.CSSProperties}>
            <li>
              <h3 className={s.h3}>Send the work</h3>
              <p className={s.muted}>
                One job or the whole week&apos;s schedule: address, squares, pitch, layers to tear off and
                when materials arrive.
              </p>
            </li>
            <li>
              <h3 className={s.h3}>We put a crew on it</h3>
              <p className={s.muted}>We assign a crew to each job and confirm the day with you.</p>
            </li>
            <li>
              <h3 className={s.h3}>You get an invoice per job</h3>
              <p className={s.muted}>
                When the roof is done, the invoice for that job comes to you by email as a PDF.
              </p>
            </li>
          </ol>
        </section>

        <section className={`${s.dark} ${s.section}`} aria-labelledby="gc-price-title">
          <div className={`${s.wrap} ${s.split}`}>
            <h2 id="gc-price-title" className={s.h2}>How we price</h2>
            <dl className={s.facts} style={{ "--cols": 1 } as React.CSSProperties}>
              <div>
                <dt>Base rate</dt>
                <dd>A rate per roofing square, agreed with each contractor.</dd>
              </div>
              <div>
                <dt>Steep roofs</dt>
                <dd>A set amount added per square as the pitch goes up.</dd>
              </div>
              <div>
                <dt>Extras</dt>
                <dd>Plywood sheets, an extra layer of tear-off or a second story, each listed on its own line.</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>New Jersey Home Improvement Contractor #{HIC_NUMBER}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={`${s.white} ${s.section}`} aria-labelledby="gc-closing-title">
          <div className={`${s.wrap} ${s.closing}`}>
            <h2 id="gc-closing-title" className={s.h2}>Ask for our current rates.</h2>
            <div className={s.actions}>{reachable ? <ContactLinks contact={contact} text /> : fallback}</div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Labor-only roofing crews",
          serviceType: "Roofing subcontracting",
          url: canonicalUrl("contractors"),
          areaServed: "Atlantic City, NJ and surrounding area",
          provider: {
            "@type": "RoofingContractor",
            name: ROOFING_NAME,
            url: canonicalUrl("roofing"),
            parentOrganization: { "@type": "Organization", name: COMPANY_NAME },
            ...(contact.phone ? { telephone: contact.phone } : {}),
          },
        }}
      />
    </>
  );
}
