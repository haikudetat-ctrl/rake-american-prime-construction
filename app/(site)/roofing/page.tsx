import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import wordmark from "@/public/brand/ap-roofing-wordmark.png";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "@/app/(site)/_components/chrome";
import { ContactLinks } from "@/app/(site)/_components/contact";
import { Closing, Faq, PhotoHero, ServiceArea, TrustStrip } from "@/app/(site)/_components/marketing";
import { roofingNav } from "@/app/(site)/roofing/nav";
import { NEED_LABEL, type Need } from "@/lib/leads/schema";
import {
  COMPANY_NAME,
  HIC_NUMBER,
  PATHS,
  REQUEST_HREF,
  ROOFING_NAME,
  WORKMANSHIP_WARRANTY_YEARS,
  canonicalUrl,
} from "@/lib/site/config";
import { getSiteContent, type RoofSystem } from "@/lib/site/content";
import s from "../site.module.css";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `Roof replacement, repair and gutters | ${ROOFING_NAME}`,
  description:
    "Roof replacement, leak repair, gutters and storm damage from Hamilton to Atlantic City and surrounding areas. A written proposal with good, better and best GAF options, signed online, and a 10-year workmanship warranty.",
  alternates: { canonical: canonicalUrl("roofing") },
  robots: { index: true, follow: true },
  openGraph: {
    title: ROOFING_NAME,
    description: "Roof replacement, repairs and gutters from Hamilton to Atlantic City, with the price in writing.",
    url: canonicalUrl("roofing"),
    siteName: ROOFING_NAME,
    type: "website",
  },
};

/** One row per option on the estimate form; each link opens the form with it chosen. */
const SERVICES: { need: Need; title: string; body: string }[] = [
  { need: "replacement", title: "Roof replacement", body: "Tear-off and a new GAF shingle roof, with the scope and price written out before work starts." },
  { need: "repair", title: "Leaks and repairs", body: "Find where the water is getting in and fix it, from flashing and pipe boots to damaged shingles." },
  { need: "inspection", title: "Inspections and estimates", body: "A look at the roof's condition and a written estimate you can keep." },
  { need: "gutters", title: "Gutters", body: "Seamless gutters on their own, or added to a new roof." },
  { need: "storm", title: "Storm damage", body: "Wind and storm damage checked and repaired." },
];

const TIER_NAME = { good: "Good", better: "Better", best: "Best" } as const;
/** Without the catalog (no database in a local build) the sheet shows the tiers alone. */
const FALLBACK_SYSTEMS: RoofSystem[] = [
  { tier: "good", name: "Good" },
  { tier: "better", name: "Better" },
  { tier: "best", name: "Best" },
];

function ProposalSheet({ systems, addons }: { systems: RoofSystem[]; addons: string[] }) {
  const named = systems.length > 0;
  const options = named ? systems.slice(0, 3) : FALLBACK_SYSTEMS;
  const picked = options.find((o) => o.tier === "better") ?? options[0];
  const extras = addons.slice(0, 2).join(", ");
  return (
    <figure className={s.sheetFigure}>
      <div
        className={s.sheet}
        role="img"
        aria-label={`Example proposal: ${options.map((o) => o.name).join(", ")}, optional add-ons, a ${WORKMANSHIP_WARRANTY_YEARS}-year workmanship warranty and an online signature.`}
      >
        <div className={s.sheetTop}>
          <Image src={wordmark} alt="" />
          <span className={s.sheetDoc}>Proposal</span>
        </div>
        <p className={s.sheetTitle}>Your new roof</p>
        <p className={s.sheetSub}>Choose one option</p>
        <ul className={s.options}>
          {options.map((o) => (
            <li key={o.tier} className={`${s.option} ${o === picked ? s.optionPicked : ""}`}>
              <span className={s.radio} />
              <span>
                <span className={s.optionName}>{o.name}</span>
                {named && (
                  <>
                    <br />
                    <span className={s.optionTier}>{TIER_NAME[o.tier]}</span>
                  </>
                )}
              </span>
              <span className={s.priceBar} />
            </li>
          ))}
        </ul>
        <dl className={s.sheetRows}>
          {extras && (
            <div>
              <dt>Optional add-ons</dt>
              <dd>{extras}</dd>
            </div>
          )}
          <div>
            <dt>Workmanship warranty</dt>
            <dd>{WORKMANSHIP_WARRANTY_YEARS} years</dd>
          </div>
          <div>
            <dt>NJ HIC</dt>
            <dd>#{HIC_NUMBER}</dd>
          </div>
        </dl>
        <div className={s.signLine}>
          <span className={s.signature}>Your name</span>
          <span className={s.sheetDoc}>Accept and sign</span>
        </div>
      </div>
      <figcaption className={s.sheetCaption}>
        The proposal you get after we measure, with prices for your roof filled in.
      </figcaption>
    </figure>
  );
}

export default async function RoofingPage() {
  const { contacts, systems, addons, gallery } = await getSiteContent();
  const contact = contacts.roofing;

  return (
    <>
      <SkipLink />
      <SiteHeader brand="roofing" nav={roofingNav()} cta={{ href: REQUEST_HREF.roofing, label: "Request an estimate" }} />
      <main id="main">
        <PhotoHero label="AP Roofing & Gutters" title="A good roof. A little peace of mind." intro="Roof replacement, repairs, and gutters. Clear options and a written proposal for the home you care about.">
          <Link href={REQUEST_HREF.roofing} prefetch={false} className={s.btn}>Request an estimate <span aria-hidden="true">↗</span></Link>
          <Link href="#services" className={s.textLink}>Explore our services</Link>
        </PhotoHero>
        <TrustStrip />

        <section id="services" className={`${s.wrap} ${s.section}`} aria-labelledby="services-title">
          <div className={s.sectionHead}>
            <h2 id="services-title" className={s.h2}>Care for every part<br />of your roof.</h2>
            <p className={s.muted}>
              Every job starts with the same estimate form. Choose the kind of work and we&apos;ll call or
              text to set up a visit.
            </p>
          </div>
          <ul className={s.rows}>
            {SERVICES.map((service) => (
              <li key={service.need} className={s.row}>
                <h3 className={s.h3}>{service.title}</h3>
                <p className={s.muted}>{service.body}</p>
                <Link
                  href={`${REQUEST_HREF.roofing}?need=${service.need}`}
                  prefetch={false}
                  className={s.textLink}
                  aria-label={`Request an estimate: ${NEED_LABEL[service.need]}`}
                >
                  Request an estimate
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className={`${s.white} ${s.section}`} aria-labelledby="how-title">
          <div className={s.wrap}>
            <div className={s.sectionHead}>
              <h2 id="how-title" className={s.h2}>From the first hello<br />to the final shingle.</h2>
            </div>
            <ol className={s.steps}>
              <li>
                <h3 className={s.h3}>Request an estimate</h3>
                <p className={s.muted}>Fill in the online form with the address and what you need. No account needed.</p>
              </li>
              <li>
                <h3 className={s.h3}>We measure the roof</h3>
                <p className={s.muted}>We call or text to set up a visit, then measure and look at the roof.</p>
              </li>
              <li>
                <h3 className={s.h3}>You choose and sign</h3>
                <p className={s.muted}>
                  Your proposal lists each option with its price. Pick one, add any extras and sign online.
                  You get a PDF copy.
                </p>
              </li>
              <li>
                <h3 className={s.h3}>We install</h3>
                <p className={s.muted}>We schedule the crew and keep you posted until the job is done.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className={`${s.wrap} ${s.section}`} aria-labelledby="proposal-title">
          <div className={s.proposalGrid}>
            <div><h2 id="proposal-title" className={s.h2}>Your options.<br />In black and white.</h2><p className={s.serifCopy}>A new roof is a big decision.<br />You deserve the details.</p><p className={s.muted}>After we measure, your proposal lays out the scope, roofing options, price, and any extras. Take a look, choose what works for your home, and sign online. You keep a PDF copy.</p></div>
            <ProposalSheet systems={systems} addons={addons} />
          </div>
        </section>

        <section id="warranty" className={`${s.dark} ${s.section}`} aria-labelledby="warranty-title">
          <div className={`${s.wrap} ${s.split}`}>
            <div>
              <h2 id="warranty-title" className={s.h2}>What you get in writing</h2>
              <p className={s.muted} style={{ marginTop: 20 }}>
                Everything we agree on goes on the proposal you sign, and you keep the PDF.
              </p>
            </div>
            <dl className={s.facts} style={{ "--cols": 1 } as React.CSSProperties}>
              <div>
                <dt>Workmanship warranty</dt>
                <dd>{WORKMANSHIP_WARRANTY_YEARS} years from {COMPANY_NAME} on every roof we install.</dd>
              </div>
              {systems.length > 0 && (
                <div>
                  <dt>Shingle systems</dt>
                  <dd>{systems.map((sys) => sys.name).join(", ")}. Manufacturer warranty terms are on your proposal.</dd>
                </div>
              )}
              <div>
                <dt>Proposal</dt>
                <dd>Scope of work, price and terms, signed online with a PDF copy for your records.</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>New Jersey Home Improvement Contractor #{HIC_NUMBER}</dd>
              </div>
            </dl>
          </div>
        </section>

        {gallery.length > 0 && (
          <section className={`${s.wrap} ${s.section}`} aria-labelledby="work-title">
            <div className={s.sectionHead}>
              <h2 id="work-title" className={s.h2}>Recent roofs</h2>
            </div>
            <div className={s.gallery}>
              {gallery.map((photo) => (
                <figure key={photo.url}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs; no image optimizer configured. */}
                  <img src={photo.url} alt={photo.caption ?? "A roof we finished"} loading="lazy" />
                  {photo.caption && <figcaption>{photo.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className={`${s.wrap} ${s.sectionTight}`} aria-labelledby="crews-title">
          <div className={s.split}>
            <h2 id="crews-title" className={s.h2}>Run a roofing company?</h2>
            <div>
              <p className={s.muted}>
                We supply labor-only crews to contractors across our service area. Send one job or your
                whole week, and each one is invoiced when it&apos;s done.
              </p>
              <Link href={PATHS.contractors} className={s.textLink}>
                Crews for contractors
              </Link>
            </div>
          </div>
        </section>

        <ServiceArea />
        <Faq items={[
          { question: "Do I need a replacement or a repair?", answer: "Tell us what you have noticed, whether it is a leak, missing shingles, or an aging roof. We will set up a visit to look at the condition and talk through the appropriate work." },
          { question: "What does the workmanship warranty cover?", answer: "We provide a 10-year workmanship warranty on every roof we install. The terms are included in your proposal. Manufacturer warranties are separate and depend on the selected shingle system." },
          { question: "Can you help with gutters only?", answer: "Yes. Choose gutters on the estimate form. Seamless gutters can be installed on their own or included with a roof replacement." },
          { question: "What happens after I request an estimate?", answer: "Our team calls or texts to confirm the project details and arrange a visit. After measuring and reviewing the roof, we send a written proposal with your options and pricing." },
        ]} />
        <Closing title="Let’s give your home a good roof."><ContactLinks contact={contact} /></Closing>
      </main>
      <SiteFooter />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "RoofingContractor",
          name: ROOFING_NAME,
          url: canonicalUrl("roofing"),
          logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/ap-roofing-logo.png`,
          parentOrganization: { "@type": "Organization", name: COMPANY_NAME, url: canonicalUrl("company") },
          areaServed: "Hamilton Township (Mercer County) to Atlantic City, NJ corridor and approximately 50 miles north and south",
          ...(contact.phone ? { telephone: contact.phone } : {}),
          ...(contact.email ? { email: contact.email } : {}),
          makesOffer: SERVICES.map((service) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: service.title },
          })),
        }}
      />
    </>
  );
}
