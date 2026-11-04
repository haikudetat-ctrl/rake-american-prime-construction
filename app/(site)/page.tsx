import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import roofingLogo from "@/public/brand/ap-roofing-wordmark.png";
import dropwiseLogo from "@/public/brand/dropwise-logo.png";
import { JsonLd, SiteFooter, SiteHeader, SkipLink } from "./_components/chrome";
import { Faq, PhotoHero, ServiceArea, TrustStrip } from "./_components/marketing";
import { COMPANY_NAME, DROPWISE_NAME, PATHS, REQUEST_HREF, ROOFING_NAME, canonicalUrl } from "@/lib/site/config";
import s from "./site.module.css";

export const metadata: Metadata = {
  title: `${COMPANY_NAME} | Roofing, gutters & dumpster rentals`,
  description: "Roofing, gutters and roll-off dumpster rentals from Hamilton to Atlantic City and surrounding areas. Meet AP Roofing & Gutters and DropWise, part of American Prime Construction.",
  alternates: { canonical: canonicalUrl("company") }, robots: { index: true, follow: true },
  openGraph: { title: COMPANY_NAME, description: "Good work. A home you can feel good about.", url: canonicalUrl("company"), siteName: COMPANY_NAME, type: "website" },
};
const nav = [{ href: PATHS.roofing, label: "Roofing & gutters" }, { href: PATHS.dumpster, label: "Dumpsters" }, { href: "#about", label: "Our company" }, { href: "#service-area", label: "Service area" }];

export default function CompanyHome() {
  return <>
    <SkipLink /><SiteHeader brand="company" nav={nav} cta={{ href: "#services", label: "Request an estimate" }} />
    <main id="main">
      <PhotoHero label="American Prime Construction" title="Good work. A place to call home." intro="Roofing, gutters, and dumpster rentals. Thoughtful help for the home you’re making your own.">
        <Link href="#services" className={s.btn}>Request an estimate <span aria-hidden="true">↗</span></Link>
        <Link href="#about" className={s.textLink}>Meet American Prime</Link>
      </PhotoHero>
      <TrustStrip />
      <section id="services" className={`${s.wrap} ${s.section}`} aria-labelledby="services-title">
        <div className={s.sectionHead}><h2 id="services-title" className={s.h2}>Your project.<br />The right people.</h2><p className={s.serifCopy}>A roof that protects. Room for a fresh start.<br />Two services. One American Prime family.</p></div>
        <div className={s.serviceCards}>
          <article className={s.serviceCard}>
            <div className={s.serviceLogo}><Image src={roofingLogo} alt={ROOFING_NAME} /></div>
            <h3 className={s.h3}>Take care of what&apos;s overhead.</h3>
            <p className={s.muted}>From a persistent leak to a new GAF shingle roof, AP Roofing & Gutters helps protect the place you call home—with your scope, options, and price in writing.</p>
            <ul className={s.inlineList}><li>Roof replacement</li><li>Repairs</li><li>Gutters</li></ul>
            <Link href={REQUEST_HREF.roofing} prefetch={false} className={s.btn}>Request a roofing estimate <span aria-hidden="true">↗</span></Link>
            <Link href={PATHS.roofing} className={s.textLink}>Explore roofing & gutters</Link>
          </article>
          <article className={s.serviceCard}>
            <div className={s.serviceLogo}><Image src={dropwiseLogo} alt={DROPWISE_NAME} /></div>
            <h3 className={s.h3}>Make room for what&apos;s next.</h3>
            <p className={s.muted}>The garage cleanout, the renovation, the project you&apos;ve been putting off. DropWise brings the dumpster so you can get to work, then coordinates the pickup.</p>
            <ul className={s.inlineList}><li>10, 15 & 20 yards</li><li>Delivery & pickup</li><li>Home & job site</li></ul>
            <Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.btn}>Request a dumpster estimate <span aria-hidden="true">↗</span></Link>
            <Link href={PATHS.dumpster} className={s.textLink}>Find your dumpster size</Link>
          </article>
        </div>
      </section>
      <section id="about" className={s.aboutSection} aria-labelledby="about-title"><div className={`${s.wrap} ${s.aboutGrid}`}>
        <div><p className={s.eyebrow}>The American Prime family</p><h2 id="about-title" className={s.h2}>Your home means a lot.<br />So does the work.</h2></div>
        <div><p className={s.serifCopy}>Big decisions feel better when the next step is clear.</p><p className={s.muted}>American Prime Construction brings AP Roofing & Gutters and DropWise Dumpsters together under one parent company. Whether you&apos;re protecting your home or making room to improve it, you can start with a simple request.</p><p className={s.muted}>Tell us about the project. We&apos;ll confirm the details, explain your options, and help you work out what comes next.</p></div>
      </div></section>
      <section className={`${s.wrap} ${s.section}`} aria-labelledby="how-title"><div className={s.sectionHead}><h2 id="how-title" className={s.h2}>A simple place to start.</h2></div>
        <ol className={s.steps} style={{ "--steps": 3 } as React.CSSProperties}>
          <li><h3 className={s.h3}>Tell us what you need</h3><p className={s.muted}>Choose roofing or dumpsters. Share your address and a few details about the project.</p></li>
          <li><h3 className={s.h3}>We talk through the details</h3><p className={s.muted}>We confirm your location and the next step, from a roofing visit to dumpster availability.</p></li>
          <li><h3 className={s.h3}>Make your plan</h3><p className={s.muted}>Review your roofing proposal or rental details before work is scheduled.</p></li>
        </ol>
      </section>
      <ServiceArea company />
      <section className={`${s.wrap} ${s.contractorBand}`}><div><h2 className={s.h3}>A crew for the work you&apos;ve lined up.</h2><p className={s.muted}>Roofing contractor? We also supply labor-only installation crews.</p></div><Link href={PATHS.contractors} className={s.textLink}>For contractors <span aria-hidden="true">↗</span></Link></section>
      <Faq items={[
        { question: "Which company should I contact?", answer: "For roofs, repairs, inspections, or gutters, choose AP Roofing & Gutters. For a roll-off dumpster, choose DropWise. Both are services of American Prime Construction." },
        { question: "Can I start without creating an account?", answer: "Yes. Both request forms work without an account. Share your contact details and project address so our team can follow up." },
        { question: "Do you work in my area?", answer: "We serve the Hamilton Township in Mercer County to Atlantic City corridor and approximately 50 miles north and south of that line. Send your project address so we can confirm service and availability." },
        { question: "Can you help with both a roof and a dumpster?", answer: "Tell us about both needs in your request. Our team will confirm what is needed for your project and coordinate the next steps with you." },
      ]} />
      <section className={s.closingSection}><div className={`${s.wrap} ${s.closing}`}><div><h2 className={s.h2}>What&apos;s next for your home?</h2><p className={s.serifCopy}>Let&apos;s get your project moving.</p></div><div className={s.actions}><Link href={REQUEST_HREF.roofing} prefetch={false} className={s.btn}>Roofing estimate <span aria-hidden="true">↗</span></Link><Link href={REQUEST_HREF.dumpster} prefetch={false} className={s.btn}>Dumpster estimate <span aria-hidden="true">↗</span></Link></div></div></section>
    </main><SiteFooter />
    <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: COMPANY_NAME, url: canonicalUrl("company"), logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/american-prime-drive.png`, brand: [{ "@type": "Brand", name: ROOFING_NAME, url: canonicalUrl("roofing") }, { "@type": "Brand", name: DROPWISE_NAME, url: canonicalUrl("dumpster") }] }} />
  </>;
}
