import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "@/app/(site)/_components/chrome";
import { Closing, Faq, Journey, PhotoHero, ServiceArea, type JourneyStep } from "@/app/(site)/_components/marketing";
import { ContactLinks } from "@/app/(site)/_components/contact";
import { COMPANY_NAME, DROPWISE_NAME, REQUEST_HREF, canonicalUrl } from "@/lib/site/config";
import { getSiteContent } from "@/lib/site/content";
import s from "../site.module.css";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: `Dumpster rentals | ${DROPWISE_NAME}`,
  description: "20-yard roll-off dumpsters for construction debris: roof tear-offs, renovations and job sites from Hamilton to Atlantic City. Request one online.",
  alternates: { canonical: canonicalUrl("dumpster") }, robots: { index: true, follow: true },
  openGraph: { title: `Tear it out. We’ll haul it away. | ${DROPWISE_NAME}`, description: "Roll-off dumpsters for construction debris, from a roofing company that uses them on its own jobs.", url: canonicalUrl("dumpster"), siteName: DROPWISE_NAME, type: "website" },
};
const nav = [{ href: "#sizes", label: "The dumpster" }, { href: "#how", label: "How it works" }, { href: "#service-area", label: "Service area" }, { href: canonicalUrl("company"), label: "American Prime" }];

const HOW: JourneyStep[] = [
  { who: "you", title: "Tell us about the project", body: "The address, the day you want it, and what's going in it.", link: { href: REQUEST_HREF.dumpster, label: "Request a dumpster", arrow: "↗", request: true } },
  { who: "us", title: "We drop it off", body: "We confirm by text and agree on where it goes and when." },
  { who: "you", title: "You load it up", body: "Fill it up. When you're done, let us know." },
  { who: "us", title: "We haul it away", body: "We set up the pickup and take it from there." },
];

export default async function DropWiseHome() {
  const { contacts } = await getSiteContent();
  return <>
    <SkipLink /><SiteHeader brand="dumpster" nav={nav} cta={{ href: REQUEST_HREF.dumpster, label: "Request an estimate" }} />
    <main id="main">
      <PhotoHero backdrop label="DropWise Dumpsters" title={<>Tear it out.<br />We’ll haul it away.</>} titleClassName={s.displayTight} intro="Roll-off dumpsters for construction debris. Tear-offs, renovations, new builds. DropWise started with the debris from our own roofs, so we know what a job site needs." image="dumpster">
        <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.btn}>Request a dumpster estimate <span aria-hidden="true">↗</span></Link>
        <a href="#sizes" className={s.textLink}>See the dumpster</a>
      </PhotoHero>
      <div className={s.trustStrip}><div className={`${s.wrap} ${s.trustGrid}`}>
        <div><strong>20-yard cans</strong><span>One size, so there&apos;s no guessing</span></div>
        <div><strong>Delivery & pickup</strong><span>Confirmed with you by text</span></div>
        <div><strong>Run by a roofing company</strong><span>We use these on our own jobs</span></div>
      </div></div>
      <section id="sizes" className={`${s.wrap} ${s.section}`} aria-labelledby="sizes-title">
        <div className={s.aboutGrid}>
          <div className={s.sectionHead}><h2 id="sizes-title" className={s.h2}>One size.<br />Twenty yards.</h2><p className={s.serifCopy}>Every DropWise can is a 20-yard, so there&apos;s no guessing. Tell us the job and we&apos;ll tell you if it takes one or two.</p></div>
          <article className={s.sizeCard}>
            <h3 className={s.sizeNumber}>20 <span>yard</span></h3><p>About 6 pickup-truck loads</p>
            <ul><li>Roof tear-offs</li><li>Renovations and demo</li><li>New construction</li></ul>
            <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.textLink}>Request a 20-yard <span aria-hidden="true">↗</span></Link>
          </article>
        </div>
        <p className={s.note}>Capacity is a rough guide. We confirm weight limits and accepted materials with your rental.</p>
      </section>
      <section id="how" className={s.aboutSection} aria-labelledby="how-title"><div className={s.wrap}>
        <div className={s.sectionHead}><h2 id="how-title" className={s.h2}>You fill it.<br />We take it from there.</h2><p className={s.serifCopy}>You tell us and you fill it. We do the driving.</p></div>
        <Journey steps={HOW} />
      </div></section>
      <section className={`${s.wrap} ${s.section}`} aria-labelledby="about-title"><div className={s.aboutGrid}>
        <div><h2 id="about-title" className={s.h2}>Built for<br />job sites.</h2></div>
        <div><p className={s.serifCopy}>We started DropWise for our own roofing jobs.</p><p className={s.muted}>Now roofing contractors, remodelers and builders use them too, on tear-offs, renovations and active job sites. DropWise is part of American Prime Construction.</p><p className={s.muted}>Running jobs every week? Ask about a standing order and one statement a week instead of a pile of invoices. Tight lot or a busy street? Tell us about the spot and we&apos;ll work out where the can goes before anything is scheduled.</p><div className={s.actions} style={{ marginTop: 24 }}><ContactLinks contact={contacts.dumpster} /></div></div>
      </div></section>
      <ServiceArea dumpster />
      <Faq items={[
        { question: "Do you have smaller dumpsters?", answer: "No. Every can is a 20-yard. Tell us the job, like the squares and layers on a tear-off or the scope of a remodel, and we'll tell you if it takes one can or two." },
        { question: "Do you work with contractors every week?", answer: "Yes. Most of our cans go to roofing companies and builders. Ask about a standing order and a single weekly statement." },
        { question: "What can go in it?", answer: "Tell us in your request. We'll confirm what's accepted, what isn't, and any weight limits before we schedule." },
        { question: "How much does it cost?", answer: "Send your address, the date and the project. We'll confirm the price, rental period and terms for your spot before anything is booked." },
        { question: "Where can it go?", answer: "Tell us about the spot: driveway, lot or street. We'll confirm it works. If it's the street, check with the town about a permit first." },
        { question: "How do I get it picked up?", answer: "Let us know you're done and we'll set up the pickup." },
      ]} />
      <Closing dumpster title="Got a job coming up?" />
    </main><SiteFooter />
    <JsonLd data={{ "@context": "https://schema.org", "@type": "LocalBusiness", name: DROPWISE_NAME, description: "20-yard roll-off dumpster rentals for construction debris.", url: canonicalUrl("dumpster"), logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/dropwise-logo.png`, parentOrganization: { "@type": "Organization", name: COMPANY_NAME, url: canonicalUrl("company") }, areaServed: "Hamilton Township (Mercer County) to Atlantic City, NJ corridor and approximately 50 miles north and south", ...(contacts.dumpster.phone ? { telephone: contacts.dumpster.phone } : {}), ...(contacts.dumpster.email ? { email: contacts.dumpster.email } : {}) }} />
  </>;
}
