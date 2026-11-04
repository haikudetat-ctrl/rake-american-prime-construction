import Image from "next/image";
import Link from "next/link";
import homePhoto from "@/public/images/home-exterior.jpg";
import { HIC_NUMBER, REQUEST_HREF, WORKMANSHIP_WARRANTY_YEARS } from "@/lib/site/config";
import s from "../site.module.css";

export function PhotoHero({ label, title, intro, children, image = "home" }: {
  label: string; title: string; intro: string; children: React.ReactNode; image?: "home" | "dumpster";
}) {
  return <section className={`${s.wrap} ${s.hero}`} aria-labelledby="hero-title">
    <div className={s.heroCopy}>
      <p className={s.eyebrow}>{label}</p>
      <h1 id="hero-title" className={s.display}>{title}</h1>
      <p className={s.lede}>{intro}</p>
      <div className={s.actions}>{children}</div>
    </div>
    <figure className={s.heroPhoto}>
      {image === "home" ? <Image src={homePhoto} alt="A welcoming shingle-sided home with a gabled roof and front porch" fill preload placeholder="blur" sizes="(max-width: 760px) 100vw, 52vw" /> : <Image src="/images/dumpster-hero.webp" alt="Roll-off dumpster at a residential project" fill preload sizes="(max-width: 760px) 100vw, 52vw" />}
    </figure>
  </section>;
}

export function TrustStrip() {
  return <div className={s.trustStrip}><div className={`${s.wrap} ${s.trustGrid}`}>
    <div><strong>NJ registered</strong><span>Home Improvement Contractor #{HIC_NUMBER}</span></div>
    <div><strong>GAF shingle systems</strong><span>Options for your next roof</span></div>
    <div><strong>{WORKMANSHIP_WARRANTY_YEARS}-year warranty</strong><span>On the workmanship of every roof we install</span></div>
  </div></div>;
}

export function ServiceArea({ dumpster = false, company = false, contractors = false }: { dumpster?: boolean; company?: boolean; contractors?: boolean }) {
  return <section id="service-area" className={`${s.wrap} ${s.section}`} aria-labelledby="area-title">
    <div className={s.areaPanel}>
      <div><p className={s.eyebrow}>Close to home</p><h2 id="area-title" className={s.h2}>From Hamilton<br />to the shore.</h2></div>
      <div><p className={s.serifCopy}>A local project deserves a team you can reach.</p>
        <p className={s.muted}>We serve the Hamilton Township (Mercer County) to Atlantic City corridor, extending roughly 50 miles north and south of that line. Share your project address and we&apos;ll confirm service and availability.</p>
        <Link href={company ? "#services" : dumpster ? REQUEST_HREF.dumpster : contractors ? `${REQUEST_HREF.roofing}?need=other` : REQUEST_HREF.roofing} prefetch={false} className={s.textLink}>Check your project address <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
  </section>;
}

export type FaqItem = { question: string; answer: string };
export function Faq({ items }: { items: FaqItem[] }) {
  return <section className={`${s.wrap} ${s.section}`} aria-labelledby="faq-title">
    <div className={s.faqGrid}><div><h2 id="faq-title" className={s.h2}>A few things<br />you may be wondering.</h2><p className={s.serifCopy}>Let&apos;s make the next step a little clearer.</p></div>
    <div className={s.faqList}>{items.map(item=><details key={item.question} className={s.faqItem}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></div>
  </section>;
}

export function Closing({ title = "Let’s take care of your next project.", dumpster = false, children }: { title?: string; dumpster?: boolean; children?: React.ReactNode }) {
  return <section className={s.closingSection}><div className={`${s.wrap} ${s.closing}`}>
    <div><h2 className={s.h2}>{title}</h2><p className={s.serifCopy}>Tell us what you have in mind. We&apos;ll help with the next step.</p></div>
    <div className={s.actions}><Link href={dumpster ? REQUEST_HREF.dumpster : REQUEST_HREF.roofing} prefetch={false} className={s.btn}>{dumpster ? "Request a dumpster estimate" : "Request an estimate"}<span aria-hidden="true">↗</span></Link>{children}</div>
  </div></section>;
}
