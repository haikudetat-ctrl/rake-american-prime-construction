import Image from "next/image";
import Link from "next/link";
import roofingLogo from "@/public/brand/ap-roofing-wordmark.png";
import dumpsterLogo from "@/public/brand/dropwise-logo.png";
import { formatPhone } from "@/lib/phone";
import { publicDisplay, publicSerif } from "./public-fonts";
import site from "@/app/(site)/site.module.css";
import s from "./intake.module.css";

type Kind = "roofing" | "dumpster";
export function IntakeShell({ kind, title, intro, phone, children, completed = false }: {
  kind: Kind; title: string; intro: string; phone?: string | null; children: React.ReactNode; completed?: boolean;
}) {
  const roofing = kind === "roofing";
  const home = roofing ? "/roofing" : "/dumpsters";
  return <div className={`${site.site} ${publicDisplay.variable} ${publicSerif.variable} ${s.shell}`}>
    <a className={site.skip} href="#request-main">Skip to request</a>
    <header className={s.header}><div className={s.headerInner}>
      <Link href={home} className={s.brand} data-brand={kind} aria-label={roofing ? "AP Roofing & Gutters home" : "DropWise Dumpsters home"}>
        <Image src={roofing ? roofingLogo : dumpsterLogo} alt={roofing ? "AP Roofing & Gutters" : "DropWise Dumpsters"} preload />
        <span>An American Prime company</span>
      </Link>
      <Link href={home} className={s.backLink}><span aria-hidden="true">←</span> Back to {roofing ? "roofing" : "dumpsters"}</Link>
    </div></header>
    <main id="request-main" className={s.layout}>
      <aside className={s.intro}>
        <p className={s.eyebrow}>{roofing ? "A little peace of mind starts here" : "Make room for what’s next"}</p>
        <h1 className={s.title}>{title}</h1>
        <p className={s.introText}>{intro}</p>
        <div className={s.nextSteps}>
          <h2>What happens next</h2>
          <ol>
            <li><span>01</span><p>{completed ? "Our team reviews your project details." : "Share a few details about your project."}</p></li>
            <li><span>02</span><p>{roofing ? "We’ll call or text to arrange a roofing visit." : "We’ll confirm your size, location, and availability."}</p></li>
            <li><span>03</span><p>{roofing ? "Review your options and price in a written proposal." : "Review pricing and rental details before scheduling."}</p></li>
          </ol>
        </div>
        {phone && <p className={s.callout}>Prefer to talk it through?<br /><a href={`tel:${phone}`}>Call {formatPhone(phone)}</a></p>}
        <p className={s.assurance}>{roofing ? "NJ HIC #13VH13312300 · 10-year workmanship warranty on roofs we install." : "10, 15 & 20-yard roll-off dumpsters. Delivery and pickup coordinated with our team."}</p>
      </aside>
      <div className={s.formColumn}>{children}</div>
    </main>
    <footer className={s.footer}><Link href="/">American Prime Construction</Link><span>Roofing, gutters & dumpster rentals</span></footer>
  </div>;
}

export function IntakeSuccess({ kind, phone, referral }: { kind: Kind; phone?: string | null; referral?: string }) {
  const roofing = kind === "roofing";
  return <IntakeShell kind={kind} title="You’re on our list." intro={roofing ? "Your roofing request is in. We’ll be in touch to talk through the project." : "Your dumpster request is in. We’ll be in touch to confirm the details."} phone={phone} completed>
    <section className={s.success} aria-labelledby="success-title">
      <span className={s.successMark} aria-hidden="true">✓</span>
      <p className={s.eyebrow}>Request received</p>
      <h2 id="success-title">Thanks. We’ve got it.</h2>
      <p>{roofing ? "Our team will reach out to arrange a time to look at your roof. You don’t need to send another request." : "We’ll text you to confirm availability, pricing, and your preferred drop-off date. Your delivery is not booked until we confirm it with you."}</p>
      {referral && <p>And say thanks to {referral} for sending you our way.</p>}
      {phone && <p>Need to add or change something? <a href={`tel:${phone}`}>Call {formatPhone(phone)}</a>.</p>}
      <Link className={s.primary} href={roofing ? "/roofing" : "/dumpsters"}>Back to {roofing ? "roofing & gutters" : "dumpsters"} <span aria-hidden="true">↗</span></Link>
    </section>
  </IntakeShell>;
}
