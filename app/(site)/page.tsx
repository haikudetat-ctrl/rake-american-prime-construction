import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import roofingLogo from "@/public/brand/authority-roofing-lockup.png";
import dropwiseLogo from "@/public/brand/dropwise-logo.png";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "./_components/chrome";
import { Faq, Journey, PhotoHero, ServiceArea, TrustStrip, type JourneyStep } from "./_components/marketing";
import { COMPANY_NAME, DROPWISE_NAME, PATHS, REQUEST_HREF, ROOFING_NAME, canonicalUrl } from "@/lib/site/config";
import s from "./site.module.css";

export const metadata: Metadata = {
  title: `${COMPANY_NAME} | Roofing, gutters & dumpster rentals`,
  description: "Roofing, gutters and roll-off dumpsters from Hamilton to Atlantic City. Authority Roofing and DropWise Dumpsters, both run by American Prime Construction.",
  alternates: { canonical: canonicalUrl("company") }, robots: { index: true, follow: true },
  openGraph: { title: COMPANY_NAME, description: "Good work gets around. Roofing, gutters and dumpsters from Hamilton to Atlantic City.", url: canonicalUrl("company"), siteName: COMPANY_NAME, type: "website" },
};
const nav = [{ href: PATHS.roofing, label: "Roofing & gutters" }, { href: PATHS.dumpster, label: "Dumpsters" }, { href: "#about", label: "Our company" }, { href: "#service-area", label: "Service area" }];

const HOW: JourneyStep[] = [
  { who: "you", title: "Tell us what's going on", body: "Pick roofing or a dumpster and give us the address. No account, no hoops.", link: { href: "#services", label: "Pick a service", arrow: "↑" } },
  { who: "us", title: "We talk it through", body: "We call or text to go over the details and set up a roof visit or a drop-off." },
  { who: "you", title: "You decide", body: "You get the price and the plan in writing before anything is scheduled." },
  { who: "us", title: "We get to work", body: "We schedule the crew or the drop-off and keep you posted until it's done." },
];

export default function CompanyHome() {
  return <>
    <SkipLink /><SiteHeader brand="company" nav={nav} cta={{ href: "#services", label: "Request an estimate" }} />
    <main id="main">
      <PhotoHero backdrop label="American Prime Construction" title={<>Good work<br />gets around.</>} titleClassName={s.displayTight} intro="Most of our jobs come from someone who saw the last one. Roofing, gutters and dumpster rentals from Hamilton to Atlantic City.">
        <Link href="#services" className={s.btn}>Request an estimate <span aria-hidden="true">↗</span></Link>
        <Link href="#about" className={s.textLink}>Who we are</Link>
      </PhotoHero>
      <TrustStrip />
      <section id="services" className={`${s.wrap} ${s.section}`} aria-labelledby="services-title">
        <div className={s.sectionHead}><h2 id="services-title" className={s.h2}>Two services.<br />Same standard.</h2><p className={s.serifCopy}>Authority Roofing does the roofs. DropWise hauls the debris.<br />Same company, same people, same attention.</p></div>
        <div className={s.serviceCards}>
          <article className={`${s.serviceCard} ${s.roofingAccent}`}>
            <div className={s.serviceLogo}><Image src={roofingLogo} alt={ROOFING_NAME} /></div>
            <h3 className={s.h3}>Roofs, repairs and gutters.</h3>
            <p className={s.muted}>A leak, storm damage or a full replacement. We measure, show you every option with its price in writing, and tell you which one actually makes sense for your house.</p>
            <ul className={s.inlineList}><li>Roof replacement</li><li>Repairs</li><li>Gutters</li></ul>
            <Link href={REQUEST_HREF.roofing} prefetch={false} className={s.btn}>Request a roofing estimate <span aria-hidden="true">↗</span></Link>
            <Link href={PATHS.roofing} className={s.textLink}>See Authority Roofing</Link>
          </article>
          <article className={`${s.serviceCard} ${s.dropwiseAccent}`}>
            <div className={s.serviceLogo}><Image src={dropwiseLogo} alt={DROPWISE_NAME} /></div>
            <h3 className={s.h3}>Dumpsters, dropped where you need them.</h3>
            <p className={s.muted}>DropWise started with the debris from our own roofing jobs. Now we drop roll-offs for tear-offs, renovations and job sites, and pick them up when the work is done.</p>
            <ul className={s.inlineList}><li>20-yard roll-offs</li><li>Delivery & pickup</li><li>Job sites & renovations</li></ul>
            <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.btn}>Request a dumpster estimate <span aria-hidden="true">↗</span></Link>
            <Link href={PATHS.dumpster} className={s.textLink}>See DropWise</Link>
          </article>
        </div>
      </section>
      <section id="about" className={s.aboutSection} aria-labelledby="about-title"><div className={`${s.wrap} ${s.aboutGrid}`}>
        <div><p className={s.eyebrow}>Who we are</p><h2 id="about-title" className={s.h2}>Most of our work<br />comes from referrals.</h2></div>
        <div><p className={s.serifCopy}>That only keeps happening if the last job was done right.</p><p className={s.muted}>American Prime Construction is a New Jersey roofing company run by Andrey, who still gets most of his work the old way: a neighbor, a friend or a past customer passing his number along. Authority Roofing and DropWise Dumpsters are how that work is organized today.</p><p className={s.muted}>We&apos;ll explain your options plainly, even when the honest answer is the cheaper one. Your house doesn&apos;t need to be upsold.</p></div>
      </div></section>
      <section id="how" className={`${s.wrap} ${s.section}`} aria-labelledby="how-title"><div className={s.sectionHead}><h2 id="how-title" className={s.h2}>How it starts.</h2><p className={s.serifCopy}>Two steps are yours. We handle the rest.</p></div>
        <Journey steps={HOW} />
      </section>
      <ServiceArea company />
      <section className={`${s.wrap} ${s.contractorBand}`}><div><h2 className={s.h3}>Roofing contractor with more work than hands?</h2><p className={s.muted}>Our crews install roofs for other contractors too. Labor only, invoiced per job.</p></div><Link href={PATHS.contractors} className={s.textLink}>For contractors <span aria-hidden="true">↗</span></Link></section>
      <Faq items={[
        { question: "Which one do I contact?", answer: "Roofs, leaks, inspections or gutters: Authority Roofing. A roll-off dumpster: DropWise. It's the same company behind both, so if you need both, say so in your request." },
        { question: "Do I need to make an account?", answer: "No. Both request forms take a couple of minutes and don't ask you to sign up. We just need a way to reach you and the project address." },
        { question: "Do you work in my area?", answer: "We work from Hamilton Township in Mercer County down to Atlantic City, and about 50 miles either side of that line. Send the address and we'll confirm." },
        { question: "Can you handle a roof and a dumpster on the same job?", answer: "Yes. That's how DropWise started. Put both in your request and we'll line them up together." },
      ]} />
      <section className={s.closingSection}><div className={`${s.wrap} ${s.closing}`}><div><h2 className={s.h2}>What&apos;s going on at your house?</h2><p className={s.serifCopy}>Tell us. We&apos;ll give you a straight answer.</p></div><div className={s.actions}><Link href={REQUEST_HREF.roofing} prefetch={false} className={`${s.btn} ${s.roofingAccent}`}>Roofing estimate <span aria-hidden="true">↗</span></Link><Link href={REQUEST_HREF.dumpster} prefetch={false} className={`${s.btn} ${s.dropwiseAccent}`}>Dumpster estimate <span aria-hidden="true">↗</span></Link></div></div></section>
    </main><SiteFooter />
    <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: COMPANY_NAME, url: canonicalUrl("company"), logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/american-prime-drive.png`, brand: [{ "@type": "Brand", name: ROOFING_NAME, url: canonicalUrl("roofing") }, { "@type": "Brand", name: DROPWISE_NAME, url: canonicalUrl("dumpster") }] }} />
  </>;
}
