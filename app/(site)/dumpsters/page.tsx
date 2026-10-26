import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Bebas_Neue } from "next/font/google";
import dropwiseLogo from "@/public/brand/dropwise-logo-white.png";
import { JsonLd, SiteFooter } from "@/app/(site)/_components/chrome";
import { ContactLinks } from "@/app/(site)/_components/contact";
import { COMPANY_NAME, DROPWISE_NAME, PATHS, REQUEST_HREF, canonicalUrl } from "@/lib/site/config";
import { getSiteContent } from "@/lib/site/content";
import site from "../site.module.css";
import styles from "./dropwise.module.css";

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-bebas",
});
const requestHref = REQUEST_HREF.dumpster;

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `Dumpster rentals near Atlantic City | ${DROPWISE_NAME}`,
  description:
    "Roll-off dumpsters for cleanouts, renovations, and roof tear-offs in the Atlantic City area. Explore 10, 15, and 20-yard sizes and request a dumpster from DropWise Dumpsters.",
  alternates: { canonical: canonicalUrl("dumpster") },
  robots: { index: true, follow: true },
  openGraph: {
    title: `Dumpster rentals. Made easy. | ${DROPWISE_NAME}`,
    description:
      "The right dumpster for your next project. Request your rental online.",
    url: canonicalUrl("dumpster"),
    siteName: DROPWISE_NAME,
    type: "website",
  },
};

const sizes = [
  {
    yards: 10,
    loads: "Approx. 3 pickup-truck loads",
    uses: [
      "Garage & basement cleanouts",
      "Small renovation projects",
      "Yard & household debris",
    ],
  },
  {
    yards: 15,
    loads: "Approx. 4–5 pickup-truck loads",
    uses: ["Roofing projects", "Kitchen & bath remodels", "Deck removal"],
  },
  {
    yards: 20,
    loads: "Approx. 6 pickup-truck loads",
    uses: ["Whole-home cleanouts", "Construction debris", "Larger renovations"],
  },
];

function RequestButton({
  children = "Request a Dumpster",
}: {
  children?: React.ReactNode;
}) {
  return (
    <Link href={requestHref} className={styles.button} prefetch={false}>
      {children}
      <span aria-hidden="true">↗</span>
    </Link>
  );
}

// A size comparison illustration, not a representation of a specific fleet vehicle.
function Dumpster({ size }: { size: number }) {
  return (
    <div className={styles.dumpsterScene} aria-hidden="true">
      <div
        className={styles.dumpster}
        style={{ width: `${62 + size * 0.8}%`, height: `${50 + size * 0.9}px` }}
      >
        <span className={styles.dumpsterBrand}>DROPWISE</span>
        <span className={styles.dumpsterRunner} />
      </div>
    </div>
  );
}

export default async function DropWiseHome() {
  const { contacts } = await getSiteContent();
  return (
    <>
    <div className={`${styles.landing} ${bebas.variable}`}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link
            href={PATHS.dumpster}
            aria-label={`${DROPWISE_NAME} home`}
            className={styles.logo}
          >
            <Image src={dropwiseLogo} alt={DROPWISE_NAME} className={styles.logoImage} priority />
          </Link>
          <nav aria-label="Main navigation" className={styles.desktopNav}>
            <a href="#dumpsters">Dumpster Rentals</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#service-area">Service Area</a>
            <a href="#about">About</a>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/login" className={styles.staffLink}>
              Team sign in
            </Link>
            <RequestButton />
          </div>
          <details className={styles.mobileNav}>
            <summary>
              Menu <span aria-hidden="true">+</span>
            </summary>
            <nav aria-label="Mobile navigation">
              <a href="#dumpsters">Dumpster Rentals</a>
              <a href="#how-it-works">How It Works</a>
              <a href="#service-area">Service Area</a>
              <a href="#about">About</a>
              <Link href="/login">Team sign in</Link>
            </nav>
          </details>
        </div>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <Image
            src="/images/dumpster-hero.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
          />
          <div className={styles.heroShade} />
          <div className={`${styles.container} ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                <span className={styles.smallRule} />
                DROPWISE DUMPSTERS
              </p>
              <h1 id="hero-title" className={styles.heroTitle}>
                DUMPSTER RENTALS.
                <br />
                <span>MADE EASY.</span>
              </h1>
              <p className={styles.heroDescription}>
                Big project. Fresh start. We help you clear the way.
                <br className={styles.desktopBreak} /> Roll-off dumpsters for
                homeowners, contractors, and builders.
              </p>
              <div className={styles.buttonRow}>
                <RequestButton />
                <a className={styles.outlineButton} href="#dumpsters">
                  Explore Dumpster Sizes<span aria-hidden="true">↓</span>
                </a>
              </div>
              <p className={styles.heroNote}>
                Tell us where and when. We’ll confirm the details by text.
              </p>
            </div>
            <div className={styles.heroBenefits}>
              {[
                "Delivery & pickup",
                "Straightforward requests",
                "Projects big & small",
                "A team you can reach",
              ].map((item, i) => (
                <span key={item}>
                  <b aria-hidden="true">0{i + 1}</b>
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>
        <div className={styles.trustStrip}>
          <div className={`${styles.container} ${styles.trustGrid}`}>
            <div>
              <strong>10–20 YARD</strong>
              <span>A size for your project</span>
            </div>
            <div>
              <strong>ONE SIMPLE REQUEST</strong>
              <span>No account needed</span>
            </div>
            <div>
              <strong>DROP OFF. LOAD UP.</strong>
              <span>We handle the hauling</span>
            </div>
            <div>
              <strong>BACKED BY AMERICAN PRIME</strong>
              <span>Construction experience at work</span>
            </div>
          </div>
        </div>
        <section
          id="dumpsters"
          className={styles.sizesSection}
          aria-labelledby="sizes-title"
        >
          <div className={styles.container}>
            <div className={styles.sectionIntro}>
              <div>
                <p className={styles.eyebrow}>FIND YOUR FIT</p>
                <h2 id="sizes-title">
                  THE RIGHT SIZE.
                  <br />
                  FOR YOUR NEXT PROJECT.
                </h2>
              </div>
              <div className={styles.introCopy}>
                <p>
                  From a weekend cleanout to a working job site, start with the
                  space you need. We’ll confirm the right size and availability
                  with you.
                </p>
                <span>
                  Capacity estimates are a guide. Images are illustrative.
                </span>
              </div>
            </div>
            <div className={styles.sizeGrid}>
              {sizes.map((size) => (
                <article key={size.yards} className={styles.sizeCard}>
                  <Dumpster size={size.yards} />
                  <p className={styles.cardEyebrow}>ROLL-OFF DUMPSTER</p>
                  <h3>
                    {size.yards} <span>YARD</span>
                  </h3>
                  <p className={styles.loads}>{size.loads}</p>
                  <ul>
                    {size.uses.map((use) => (
                      <li key={use}>
                        <span aria-hidden="true">✓</span>
                        {use}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={requestHref}
                    prefetch={false}
                    className={styles.cardLink}
                    aria-label={`Request a ${size.yards} yard dumpster`}
                  >
                    Request this size <span aria-hidden="true">↗</span>
                  </Link>
                </article>
              ))}
            </div>
            <p className={styles.sizeHelp}>
              Not sure which size?{" "}
              <Link href={requestHref} prefetch={false}>
                Tell us about your project. We’ll help you choose.
              </Link>
            </p>
          </div>
        </section>
        <section
          id="how-it-works"
          className={styles.processSection}
          aria-labelledby="process-title"
        >
          <div className={`${styles.container} ${styles.processGrid}`}>
            <div>
              <p className={styles.eyebrow}>HOW IT WORKS</p>
              <h2 id="process-title">
                SIMPLE.
                <br />
                FAST.
                <br />
                <span>DONE.</span>
              </h2>
            </div>
            <ol className={styles.steps}>
              <li>
                <span className={styles.stepNumber}>01</span>
                <h3>REQUEST YOUR DUMPSTER</h3>
                <p>
                  Share your address, preferred date, and project details
                  through our online request form.
                </p>
                <Link
                  href={requestHref}
                  prefetch={false}
                  className={styles.stepLink}
                >
                  Start your request <span aria-hidden="true">↗</span>
                </Link>
              </li>
              <li>
                <span className={styles.stepNumber}>02</span>
                <h3>WE CONFIRM & DELIVER</h3>
                <p>
                  We’ll confirm availability and rental details by text, then
                  coordinate your drop-off.
                </p>
              </li>
              <li>
                <span className={styles.stepNumber}>03</span>
                <h3>YOU FILL IT. WE HAUL IT.</h3>
                <p>
                  Get to work. When you’re finished, let us know and we’ll
                  coordinate pickup.
                </p>
              </li>
            </ol>
          </div>
        </section>
        <section
          id="about"
          className={styles.aboutSection}
          aria-labelledby="about-title"
        >
          <div className={`${styles.container} ${styles.aboutGrid}`}>
            <div>
              <p className={styles.eyebrow}>BUILT AROUND YOUR PROJECT</p>
              <h2 id="about-title">
                LESS IN YOUR WAY.
                <br />
                MORE GETTING DONE.
              </h2>
            </div>
            <div className={styles.aboutCopy}>
              <p>
                Renovations, tear-offs, and cleanouts all have one thing in
                common: the debris has to go somewhere.
              </p>
              <p>
                DropWise Dumpsters, a service of American Prime Construction, helps you make room for what’s next,
                with roll-off dumpster rentals and a straightforward request
                process. Tell us what you’re working on. We’ll take it from
                there.
              </p>
              <RequestButton>Let’s Get to Work</RequestButton>
            </div>
          </div>
        </section>
        <section
          id="service-area"
          className={styles.serviceSection}
          aria-labelledby="area-title"
        >
          <div className={styles.serviceCopy}>
            <p className={styles.eyebrow}>SERVICE AREA</p>
            <h2 id="area-title">
              YOUR PROJECT.
              <br />
              OUR NEXT STOP.
            </h2>
            <p>
              Planning a project in the Atlantic City area? Send us your job
              address so we can check delivery availability.
            </p>
            <p>
              Our team will confirm service to your location, dumpster
              availability, and the rental details before scheduling.
            </p>
            <RequestButton>Check Availability</RequestButton>
          </div>
          <div
            className={styles.serviceGraphic}
            aria-label="Illustration of the Atlantic City area; delivery availability is confirmed by the team"
            role="img"
          >
            <div className={styles.mapLand} />
            <span className={styles.mapWater}>ATLANTIC OCEAN</span>
            <div className={styles.mapRoad} />
            <div className={styles.mapMarker}>
              <span />
              <b>ATLANTIC CITY</b>
            </div>
            <span className={styles.mapCaption}>
              LET’S SEE IF WE CAN GET TO YOU.
              <small>
                Illustrative map · availability confirmed by address
              </small>
            </span>
          </div>
        </section>
        <section className={styles.audienceSection} aria-label="Who we serve">
          <div className={`${styles.container} ${styles.audienceGrid}`}>
            {[
              ["01", "HOMEOWNERS", "Cleanouts, renovations & fresh starts"],
              ["02", "ROOFING CONTRACTORS", "Tear-offs & active job sites"],
              ["03", "GENERAL CONTRACTORS", "Remodeling & new construction"],
              ["04", "PROPERTY MANAGERS", "Turnovers & property cleanups"],
            ].map(([number, title, copy]) => (
              <div key={title}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.finalCta} aria-labelledby="cta-title">
          <div className={styles.container}>
            <p className={styles.eyebrow}>LET’S CLEAR THE WAY</p>
            <h2 id="cta-title">READY TO GET STARTED?</h2>
            <div className={styles.finalCtaRow}>
              <p>The right dumpster starts with a simple request.</p>
              <div className={site.actions}>
                <RequestButton />
                <ContactLinks contact={contacts.dumpster} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
      <SiteFooter />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: DROPWISE_NAME,
          description: "Roll-off dumpster rentals: 10, 15 and 20-yard dumpsters.",
          url: canonicalUrl("dumpster"),
          logo: `${canonicalUrl("company").replace(/\/$/, "")}/brand/dropwise-logo.png`,
          parentOrganization: { "@type": "Organization", name: COMPANY_NAME, url: canonicalUrl("company") },
          areaServed: "Atlantic City, NJ and surrounding area",
          ...(contacts.dumpster.phone ? { telephone: contacts.dumpster.phone } : {}),
          ...(contacts.dumpster.email ? { email: contacts.dumpster.email } : {}),
        }}
      />
    </>
  );
}
