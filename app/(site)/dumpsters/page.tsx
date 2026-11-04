import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "@/app/(site)/_components/chrome";
import { Closing, Faq, PhotoHero, ServiceArea } from "@/app/(site)/_components/marketing";
import { ContactLinks } from "@/app/(site)/_components/contact";
import { COMPANY_NAME, DROPWISE_NAME, PATHS, REQUEST_HREF, canonicalUrl } from "@/lib/site/config";
import { getSiteContent } from "@/lib/site/content";
import s from "../site.module.css";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: `Dumpster rentals | ${DROPWISE_NAME}`,
  description: "10, 15 and 20-yard roll-off dumpster rentals for cleanouts, renovations and roofing projects from Hamilton to Atlantic City and surrounding areas. Request your estimate online.",
  alternates: { canonical: canonicalUrl("dumpster") }, robots: { index: true, follow: true },
  openGraph: { title: `Make room for what’s next. | ${DROPWISE_NAME}`, description: "Roll-off dumpster rentals for your home or job site.", url: canonicalUrl("dumpster"), siteName: DROPWISE_NAME, type: "website" },
};
const sizes = [
  { yards: 10, loads: "About 3 pickup-truck loads", uses: ["Garage & basement cleanouts", "Small renovation projects", "Household debris"] },
  { yards: 15, loads: "About 4–5 pickup-truck loads", uses: ["Roofing projects", "Kitchen & bath remodels", "Deck removal"] },
  { yards: 20, loads: "About 6 pickup-truck loads", uses: ["Whole-home cleanouts", "Construction debris", "Larger renovations"] },
];
const nav = [{ href: "#sizes", label: "Dumpster sizes" }, { href: "#how", label: "How it works" }, { href: "#service-area", label: "Service area" }, { href: PATHS.company, label: "American Prime" }];

export default async function DropWiseHome() {
  const { contacts } = await getSiteContent();
  return <>
    <SkipLink /><SiteHeader brand="dumpster" nav={nav} cta={{ href: REQUEST_HREF.dumpster, label: "Request an estimate" }} />
    <main id="main">
      <PhotoHero label="DropWise Dumpsters" title="A fresh start. A little less in the way." intro="The cleanout. The renovation. The project you’re ready to start. We’ll help you make room." image="dumpster">
        <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.btn}>Request a dumpster estimate <span aria-hidden="true">↗</span></Link>
        <a href="#sizes" className={s.textLink}>Find your size</a>
      </PhotoHero>
      <div className={s.trustStrip}><div className={`${s.wrap} ${s.trustGrid}`}>
        <div><strong>10, 15 & 20 yards</strong><span>Find the space your project needs</span></div>
        <div><strong>Delivery & pickup</strong><span>Coordinated with our team</span></div>
        <div><strong>Part of American Prime</strong><span>A construction company behind your project</span></div>
      </div></div>
      <section id="sizes" className={`${s.wrap} ${s.section}`} aria-labelledby="sizes-title">
        <div className={s.sectionHead}><h2 id="sizes-title" className={s.h2}>A size for your<br />next chapter.</h2><p className={s.serifCopy}>Start with your project.<br />We&apos;ll help you find the fit.</p></div>
        <div className={s.sizeGrid}>{sizes.map(size=><article key={size.yards} className={s.sizeCard}>
          <h3 className={s.sizeNumber}>{size.yards} <span>yard</span></h3><p>{size.loads}</p>
          <ul>{size.uses.map(use=><li key={use}>{use}</li>)}</ul>
          <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.textLink} aria-label={`Request a ${size.yards}-yard dumpster`}>Request this size <span aria-hidden="true">↗</span></Link>
        </article>)}</div>
        <p className={s.note}>Capacity estimates are a guide. Tell us the size you have in mind in your request; we&apos;ll confirm availability, accepted materials, and rental details.</p>
      </section>
      <section id="how" className={s.aboutSection} aria-labelledby="how-title"><div className={s.wrap}>
        <div className={s.sectionHead}><h2 id="how-title" className={s.h2}>You fill it.<br />We take it from there.</h2></div>
        <ol className={s.steps} style={{ "--steps": 3 } as React.CSSProperties}>
          <li><h3 className={s.h3}>Tell us about the project</h3><p className={s.muted}>Share your address, preferred date, and the kind of cleanup or renovation you&apos;re planning.</p></li>
          <li><h3 className={s.h3}>We confirm & deliver</h3><p className={s.muted}>We confirm availability and rental details by text, then coordinate a place and time for drop-off.</p></li>
          <li><h3 className={s.h3}>Load up. We haul away.</h3><p className={s.muted}>Get to work. When you&apos;re finished, let us know and we&apos;ll coordinate pickup.</p></li>
        </ol>
      </div></section>
      <section className={`${s.wrap} ${s.section}`} aria-labelledby="about-title"><div className={s.aboutGrid}>
        <div><h2 id="about-title" className={s.h2}>For the projects<br />that happen at home.</h2></div>
        <div><p className={s.serifCopy}>Sometimes, making a home starts with making space.</p><p className={s.muted}>DropWise is a service of American Prime Construction. We rent roll-off dumpsters to homeowners, roofing contractors, builders, and property managers for cleanouts, renovations, and active job sites.</p><p className={s.muted}>Not sure what size you need or where a dumpster can go? Tell us about your project and access. We&apos;ll talk through the details before scheduling.</p><div className={s.actions} style={{ marginTop: 24 }}><ContactLinks contact={contacts.dumpster} /></div></div>
      </div></section>
      <ServiceArea dumpster />
      <Faq items={[
        { question: "What size dumpster do I need?", answer: "That depends on your project and materials. The 10, 15, and 20-yard options above are a starting point. Tell us what you are removing and we will help confirm a suitable size and availability." },
        { question: "What can I put in the dumpster?", answer: "Describe your debris in your request. Our team will confirm accepted materials, exclusions, and any applicable weight limits before the rental is scheduled." },
        { question: "How much does a rental cost?", answer: "Request an estimate with your address, preferred date, and project details. We will confirm pricing, rental period, and terms for your location before scheduling." },
        { question: "Where can the dumpster be placed?", answer: "Share the access and placement details with your request. We will confirm a suitable spot. If you are considering street placement, check with your municipality about permit requirements." },
        { question: "How do I arrange pickup?", answer: "Contact our team when you are finished. We will coordinate pickup with you according to the agreed rental details." },
      ]} />
      <Closing dumpster title="Let’s make room for what’s next." />
    </main><SiteFooter />
    <JsonLd data={{ "@context": "https://schema.org", "@type": "LocalBusiness", name: DROPWISE_NAME, description: "Roll-off dumpster rentals: 10, 15 and 20-yard dumpsters.", url: canonicalUrl("dumpster"), logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/dropwise-logo.png`, parentOrganization: { "@type": "Organization", name: COMPANY_NAME, url: canonicalUrl("company") }, areaServed: "Hamilton Township (Mercer County) to Atlantic City, NJ corridor and approximately 50 miles north and south", ...(contacts.dumpster.phone ? { telephone: contacts.dumpster.phone } : {}), ...(contacts.dumpster.email ? { email: contacts.dumpster.email } : {}) }} />
  </>;
}
