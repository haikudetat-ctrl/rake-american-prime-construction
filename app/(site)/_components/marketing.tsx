import Image from "next/image";
import Link from "next/link";
import homePhoto from "@/public/images/home-exterior.jpg";
import { HIC_NUMBER, REQUEST_HREF, WORKMANSHIP_WARRANTY_YEARS } from "@/lib/site/config";
import s from "../site.module.css";

export function PhotoHero({ label, title, titleClassName, intro, children, image = "home", backdrop = false }: {
  label: string; title: React.ReactNode; titleClassName?: string; intro: string; children: React.ReactNode; image?: "home" | "dumpster";
  /** Photo fills the hero behind the copy, faded out under the text (stacked below it on phones). */
  backdrop?: boolean;
}) {
  const copy = <>
    <p className={s.eyebrow}>{label}</p>
    <h1 id="hero-title" className={titleClassName ? `${s.display} ${titleClassName}` : s.display}>{title}</h1>
    <p className={s.lede}>{intro}</p>
    <div className={s.actions}>{children}</div>
  </>;
  const photo = image === "home"
    ? <Image src={homePhoto} alt="A welcoming shingle-sided home with a gabled roof and front porch" fill preload placeholder="blur" sizes={backdrop ? "100vw" : "(max-width: 760px) 100vw, 52vw"} />
    : <Image src="/images/dumpster-hero.webp" alt="Roll-off dumpster at a house under construction" fill preload sizes={backdrop ? "100vw" : "(max-width: 760px) 100vw, 52vw"} />;

  if (backdrop) {
    return <section className={s.heroBackdrop} aria-labelledby="hero-title">
      <div className={s.wrap}><div className={`${s.heroCopy} ${s.heroBackdropCopy}`}>{copy}</div></div>
      <figure className={s.heroBackdropMedia}>{photo}</figure>
    </section>;
  }
  return <section className={`${s.wrap} ${s.hero}`} aria-labelledby="hero-title">
    <div className={s.heroCopy}>{copy}</div>
    <figure className={s.heroPhoto}>{photo}</figure>
  </section>;
}

export type JourneyStep = {
  who: "you" | "us";
  title: string;
  body: string;
  link?: { href: string; label: string; arrow: string; request?: boolean };
};

/** How it works as one connected timeline. Filled nodes are the customer's steps, so they can see how little is on them. */
export function Journey({ steps }: { steps: JourneyStep[] }) {
  return <ol className={s.journey}>
    {steps.map((step, i) => (
      <li key={step.title} className={step.who === "you" ? s.journeyYou : undefined}>
        <span className={s.journeyNode} aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
        <p className={s.journeyWho}>{step.who === "you" ? "Your part" : "Our part"}</p>
        <h3 className={s.h3}>{step.title}</h3>
        <p className={s.muted}>{step.body}</p>
        {step.link && (
          <Link href={step.link.href} prefetch={step.link.request ? false : undefined} className={s.textLink}>
            {step.link.label} <span aria-hidden="true">{step.link.arrow}</span>
          </Link>
        )}
      </li>
    ))}
  </ol>;
}

export function TrustStrip() {
  return <div className={s.trustStrip}><div className={`${s.wrap} ${s.trustGrid}`}>
    <div><strong>NJ registered</strong><span>Home Improvement Contractor #{HIC_NUMBER}</span></div>
    <div><strong>GAF shingle systems</strong><span>Good, better and best, each priced in writing</span></div>
    <div><strong>{WORKMANSHIP_WARRANTY_YEARS}-year warranty</strong><span>On our workmanship, on every roof we put on</span></div>
  </div></div>;
}

export function ServiceArea({ dumpster = false, company = false, contractors = false }: { dumpster?: boolean; company?: boolean; contractors?: boolean }) {
  return <section id="service-area" className={`${s.wrap} ${s.section}`} aria-labelledby="area-title">
    <div className={s.areaPanel}>
      <div><p className={s.eyebrow}>Where we work</p><h2 id="area-title" className={s.h2}>Trenton to<br />the boardwalk.</h2></div>
      <div><p className={s.serifCopy}>Central Jersey down to the shore, and every cul-de-sac in between.</p>
        <p className={s.muted}>Not sure we reach you? Send the address. If we can&apos;t get there, we&apos;ll tell you.</p>
        <Link href={company ? "#services" : dumpster ? REQUEST_HREF.dumpster : contractors ? `${REQUEST_HREF.roofing}?need=other` : REQUEST_HREF.roofing} prefetch={false} className={s.textLink}>Check your address <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
  </section>;
}

export type FaqItem = { question: string; answer: string };
export function Faq({ items }: { items: FaqItem[] }) {
  return <section className={`${s.wrap} ${s.section}`} aria-labelledby="faq-title">
    <div className={s.faqGrid}><div><h2 id="faq-title" className={s.h2}>Questions we<br />hear a lot.</h2><p className={s.serifCopy}>Straight answers. If yours isn&apos;t here, just ask.</p></div>
    <div className={s.faqList}>{items.map(item=><details key={item.question} className={s.faqItem}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></div>
  </section>;
}

export function Closing({ title = "Let’s take care of your next project.", dumpster = false, children }: { title?: string; dumpster?: boolean; children?: React.ReactNode }) {
  return <section className={s.closingSection}><div className={`${s.wrap} ${s.closing}`}>
    <div><h2 className={s.h2}>{title}</h2><p className={s.serifCopy}>Tell us what&apos;s going on. You&apos;ll get a straight answer.</p></div>
    <div className={s.actions}><Link href={dumpster ? REQUEST_HREF.dumpster : REQUEST_HREF.roofing} prefetch={false} className={s.btn}>{dumpster ? "Request a dumpster estimate" : "Request an estimate"}<span aria-hidden="true">↗</span></Link>{children}</div>
  </div></section>;
}
