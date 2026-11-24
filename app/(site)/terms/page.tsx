import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/app/(site)/_components/legal-page";
import { COMPANY_NAME, DROPWISE_NAME, HIC_NUMBER, LEGAL_PATHS, ROOFING_NAME } from "@/lib/site/config";
import { getSiteContent } from "@/lib/site/content";
import { LEGAL, legalIdentity } from "@/lib/site/legal";
import { formatPhone } from "@/lib/phone";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: `Terms of Use | ${COMPANY_NAME}`,
  description: `Terms for using the ${COMPANY_NAME}, ${ROOFING_NAME} and ${DROPWISE_NAME} websites and text messages.`,
  robots: { index: false, follow: true },
};

/*
 * Deliberately short and consumer-friendly. New Jersey's Truth-in-Consumer
 * Contract, Warranty and Notice Act penalises consumer terms that take away
 * rights the law gives, so this page avoids blanket liability waivers,
 * indemnities and "void where prohibited" language. The signed proposal is
 * the contract for the work. Not legal advice: have a New Jersey attorney
 * review before relying on it.
 */
export default async function Terms() {
  const content = await getSiteContent();
  const { contacts } = content;
  const who = legalIdentity(content);
  const phone = contacts.roofing.phone ?? contacts.dumpster.phone;
  const email = who.email ?? "[CONTACT EMAIL: Settings, roofing business email]";
  return (
    <LegalPage title="Terms of Use" effective={LEGAL.effectiveDate}>
      <p>
        These terms apply when you use the websites of {who.name}, doing business as {COMPANY_NAME}, {ROOFING_NAME} and{" "}
        {DROPWISE_NAME} (“we”, “us”), or get text messages from us. Our{" "}
        <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link> explains how we handle your information.
      </p>

      <h2>Estimates and contracts</h2>
      <p>
        Prices, ranges and descriptions on these websites are general information, not an offer. Sending a request does not create a
        contract. Roofing and other home improvement work is done only under a written proposal that you sign, which states the scope,
        price, warranty and your cancellation rights under New Jersey law; that proposal is the agreement for the work and controls if it
        differs from anything on this site. Dumpster rentals are confirmed with you before delivery, with the price, dates and any
        rules for what can go in the dumpster [CONFIRM: link or attach the DropWise rental terms, if any].
      </p>
      <p>{COMPANY_NAME} is a registered New Jersey Home Improvement Contractor, #{HIC_NUMBER}.</p>

      <h2>Photos and information you send</h2>
      <p>
        You confirm that what you send is accurate and that you have the right to share any photos you upload. We use them to prepare
        your estimate and do the work. We will not publish photos you send, or of your property, without asking you first.
      </p>

      <h2 id="texts">Text messages</h2>
      <p>
        When you give us your mobile number on a request form, or agree to texts another way, {COMPANY_NAME} (including {ROOFING_NAME}{" "}
        and {DROPWISE_NAME}) may text you from {LEGAL.textingNumber} about your request and job: confirmations, scheduling, proposal
        links, updates and reminders. If you tick the box on our roofing form, we may also send follow-ups such as a feedback request or
        our referral program. Texts may be sent using automated technology. Agreeing is not a condition of buying anything.
      </p>
      <ul>
        <li>Message frequency varies with your request and job.</li>
        <li>Message and data rates may apply.</li>
        <li>Reply <strong>STOP</strong> to stop all texts. We will send one message confirming you are unsubscribed. Reply <strong>START</strong> to begin again.</li>
        <li>Reply <strong>HELP</strong> for help, or contact us using the details below.</li>
        <li>Carriers are not responsible for delayed or undelivered messages.</li>
        <li>We do not share your mobile number or text consent with anyone for their marketing. See our <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>.</li>
      </ul>

      <h2>Using the websites</h2>
      <p>
        Please do not misuse the sites: no automated scraping of our pages, no attempts to get into areas meant for our staff, and no
        false or spam requests. Our names, logos, text and photos belong to us or the people who licensed them to us, and you may not
        copy them for commercial use.
      </p>
      <p>
        We work to keep the information here accurate and current, but service areas, availability and prices change; we will confirm
        them with you directly. Nothing in these terms limits any right you have under New Jersey or federal consumer protection law.
      </p>

      <h2>Changes and governing law</h2>
      <p>
        We may update these terms by posting a new version here with a new effective date. New Jersey law governs these terms.
      </p>

      <h2>Contact us</h2>
      <p>
        {who.name}
        <br />
        {who.address}
        <br />
        Email: <a href={`mailto:${email}`}>{email}</a>
        {phone && (
          <>
            <br />
            Phone: <a href={`tel:${phone}`}>{formatPhone(phone)}</a>
          </>
        )}
      </p>
    </LegalPage>
  );
}
