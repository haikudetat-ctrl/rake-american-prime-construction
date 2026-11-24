import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import lockup from "@/public/brand/authority-roofing-lockup.png";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "@/app/(site)/_components/chrome";
import { ContactLinks } from "@/app/(site)/_components/contact";
import { Closing, Faq, Journey, PhotoHero, ServiceArea, TrustStrip, type JourneyStep } from "@/app/(site)/_components/marketing";
import { roofingNav } from "@/app/(site)/roofing/nav";
import { NEED_LABEL, type Need } from "@/lib/leads/schema";
import {
  COMPANY_NAME,
  HIC_NUMBER,
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
    "Roof replacement, leak repair, gutters and storm damage from Hamilton to Atlantic City. Every option priced in writing, signed online, and backed by a 10-year workmanship warranty.",
  alternates: { canonical: canonicalUrl("roofing") },
  robots: { index: true, follow: true },
  openGraph: {
    title: ROOFING_NAME,
    description: "Roofs done right, with every option and price in writing. Hamilton to Atlantic City.",
    url: canonicalUrl("roofing"),
    siteName: ROOFING_NAME,
    type: "website",
  },
};

/** One row per option on the estimate form; each link opens the form with it chosen. */
const SERVICES: { need: Need; title: string; body: string }[] = [
  { need: "replacement", title: "Roof replacement", body: "Full tear-off and a new GAF shingle roof. The scope and the price are in writing before anyone climbs a ladder." },
  { need: "repair", title: "Leaks and repairs", body: "We find where the water is actually getting in, whether it's flashing, a pipe boot or a few bad shingles, and fix that." },
  { need: "inspection", title: "Inspections and estimates", body: "An honest look at your roof and a written estimate you can keep, even if the answer is that it has years left." },
  { need: "gutters", title: "Gutters", body: "Seamless gutters on their own, or with a new roof." },
  { need: "storm", title: "Storm damage", body: "Wind or storm damage checked, photographed and repaired." },
];

/** How it works. "you" steps are the homeowner's; the node is filled so they can see they only do two things. */
const JOURNEY: JourneyStep[] = [
  { who: "you", title: "Request an estimate", body: "Tell us the address and what's going on. It takes a couple of minutes, and there's no account to make.", link: { href: REQUEST_HREF.roofing, label: "Start your request", arrow: "↗", request: true } },
  { who: "us", title: "We come out and measure", body: "We call or text to set up a time, then measure and take a real look at the roof." },
  { who: "you", title: "You pick and sign", body: "Your proposal shows each option, what it includes and what it costs. Choose one, add any extras, sign online and keep the PDF.", link: { href: "#proposal", label: "See a sample proposal", arrow: "↓" } },
  { who: "us", title: "We install", body: "Our crew does the job, and we keep you posted until it's done." },
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
          <Image src={lockup} alt="" />
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
        What your proposal looks like after we measure, with your roof&apos;s prices filled in.
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
        <PhotoHero backdrop label={ROOFING_NAME} title={<>A good roof.<br />Real peace<br />of mind.</>} titleClassName={s.displayTight} intro="Roof replacement, repairs and gutters. Every option and every price in writing, and a straight answer about which one your house actually needs.">
          <Link href={REQUEST_HREF.roofing} prefetch={false} className={s.btn}>Request an estimate <span aria-hidden="true">↗</span></Link>
          <Link href="#services" className={s.textLink}>See what we do</Link>
        </PhotoHero>
        <TrustStrip />

        <section id="services" className={`${s.wrap} ${s.section}`} aria-labelledby="services-title">
          <div className={s.sectionHead}>
            <h2 id="services-title" className={s.h2}>Whatever&apos;s going on<br />up there.</h2>
            <p className={s.muted}>
              Pick the closest match on the estimate form and we&apos;ll call or text to set up a visit.
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
              <p className={s.serifCopy}>You do two things. We take care of the rest.</p>
            </div>
            <Journey steps={JOURNEY} />
          </div>
        </section>

        <section id="proposal" className={`${s.wrap} ${s.section}`} aria-labelledby="proposal-title">
          <div className={s.proposalGrid}>
            <div><h2 id="proposal-title" className={s.h2}>Your options.<br />In black and white.</h2><p className={s.serifCopy}>Three prices, and exactly what each one gets you.</p><p className={s.muted}>Each option lists what&apos;s included, from the shingles to the underlayment, so you can see why one costs more than another. Planning to sell in a couple of years? Tell us. You probably don&apos;t need the top system, and we&apos;ll say so.</p><p className={s.muted} style={{ marginTop: 14 }}>Pick one, sign online and keep the PDF.</p></div>
            <ProposalSheet systems={systems} addons={addons} />
          </div>
        </section>

        <section id="warranty" className={`${s.dark} ${s.section}`} aria-labelledby="warranty-title">
          <div className={`${s.wrap} ${s.split}`}>
            <div>
              <h2 id="warranty-title" className={s.h2}>What you get in writing</h2>
              <p className={s.muted} style={{ marginTop: 20 }}>
                If we agreed to it, it&apos;s on the proposal you sign, and you keep the PDF.
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
                Other roofing companies already hire our crews to install their jobs. Labor only, one job
                or the whole week, invoiced when each one is done.
              </p>
              <Link href={canonicalUrl("contractors")} className={s.textLink}>
                Crews for contractors
              </Link>
            </div>
          </div>
        </section>

        <ServiceArea />
        <Faq items={[
          { question: "Do I need a new roof or just a repair?", answer: "Tell us what you're seeing: a leak, missing shingles, an old roof. We'll come look and give you a straight answer. If a repair will do it, that's what we'll recommend." },
          { question: "Why does my proposal have three prices?", answer: "Because houses and plans are different. The top option is a full system with the strongest manufacturer coverage, and the others trade some of that for a lower price. Each one lists what's included, so you're comparing real differences." },
          { question: "What does the 10-year warranty cover?", answer: "Our installation, on every roof we put on, for 10 years. The exact terms are in your proposal. Shingle warranties come from the manufacturer and depend on the system you choose." },
          { question: "Can you do gutters only?", answer: "Yes. Choose gutters on the estimate form. We do seamless gutters on their own or with a new roof." },
          { question: "What happens after I send the form?", answer: "We call or text to set up a visit, measure the roof, then send your written proposal with every option and its price." },
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
          logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/authority-roofing-logo.png`,
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
