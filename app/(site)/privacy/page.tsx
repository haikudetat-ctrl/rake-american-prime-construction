import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/app/(site)/_components/legal-page";
import { COMPANY_NAME, DROPWISE_NAME, LEGAL_PATHS, ROOFING_NAME, canonicalUrl } from "@/lib/site/config";
import { getSiteContent } from "@/lib/site/content";
import { LEGAL, legalIdentity } from "@/lib/site/legal";
import { formatPhone } from "@/lib/phone";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: `Privacy Policy | ${COMPANY_NAME}`,
  description: `How ${COMPANY_NAME}, ${ROOFING_NAME} and ${DROPWISE_NAME} collect, use and protect your information.`,
  // Reachable on every domain (texting registrations check it there); kept out of search.
  robots: { index: false, follow: true },
};

/*
 * Every statement below describes what this codebase actually does. When a
 * form field, tracker, vendor or text message type is added, update this
 * page in the same change. Not legal advice: have a New Jersey attorney
 * review before relying on it.
 */
export default async function PrivacyPolicy() {
  const content = await getSiteContent();
  const { contacts } = content;
  const who = legalIdentity(content);
  const phone = contacts.roofing.phone ?? contacts.dumpster.phone;
  const email = who.email ?? "[CONTACT EMAIL: Settings, roofing business email]";
  return (
    <LegalPage title="Privacy Policy" effective={LEGAL.effectiveDate}>
      <p>
        This policy covers the websites of {who.name}, doing business as {COMPANY_NAME}, {ROOFING_NAME} and{" "}
        {DROPWISE_NAME} (“we”, “us”), including{" "}
        <a href={canonicalUrl("company")}>{new URL(canonicalUrl("company")).host}</a>,{" "}
        <a href={canonicalUrl("roofing")}>{new URL(canonicalUrl("roofing")).host}</a> and{" "}
        <a href={canonicalUrl("dumpster")}>{new URL(canonicalUrl("dumpster")).host}</a>, and the calls, texts and emails we
        exchange with you about a request. We do not sell your information.
      </p>

      <h2>What we collect</h2>
      <h3>What you give us</h3>
      <ul>
        <li><strong>Roofing estimate requests:</strong> the kind of work, the property address, your name, phone number, email (optional), notes and any photos you upload, and whether you agreed to calls and texts (we keep the exact wording you agreed to and when).</li>
        <li><strong>Dumpster requests:</strong> the job address, the date you want it, your name, company (optional), phone number, email (optional) and notes.</li>
        <li><strong>Proposals and jobs:</strong> if you go ahead, the details of the work, your electronic signature on the proposal, scheduling, invoices and payment records, and job photos.</li>
        <li><strong>Referrals:</strong> if a past customer sends you our referral link, we know who referred you so we can thank them.</li>
        <li><strong>Calls, texts and emails:</strong> the messages you send us and records of calls, including voicemails.</li>
      </ul>
      <h3>What we collect automatically</h3>
      <ul>
        <li><strong>Visit statistics:</strong> we use Vercel Web Analytics to count page visits (page, referring site, browser, device type and approximate country). It sets no cookies and we cannot use it to identify you. It never runs on staff screens or on private links we send you.</li>
        <li><strong>Server logs and spam protection:</strong> our hosting provider records technical data such as IP address and browser type to run and secure the site. When you send a form we keep a one-way scrambled code made from your IP address to stop repeat spam; we cannot turn it back into the address.</li>
        <li><strong>Cookies:</strong> our public pages set no advertising or tracking cookies. A sign-in cookie is used only by our own staff.</li>
      </ul>
      <p>
        We do not currently use advertising pixels (such as Meta or Google ad tags). If we add them, we will update this policy first
        and give you a way to opt out.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To reply to your request, check that we serve your address, schedule a visit or delivery, and prepare an estimate or proposal.</li>
        <li>To do the work: assign a crew, deliver and pick up a dumpster, invoice, take payment and keep warranty records.</li>
        <li>To contact you by call, text or email about your request or job, and, if you agreed, to follow up afterward (for example a feedback request or our referral program).</li>
        <li>To keep the site and our records secure, prevent fraud and spam, and meet legal, tax and licensing obligations.</li>
      </ul>

      <h2>Text messages</h2>
      <p>
        If you give us your mobile number, we text you about your request and job (confirmations, scheduling, proposal links, updates
        and reminders). Message frequency varies. Message and data rates may apply. Reply <strong>STOP</strong> to stop texts at any
        time, or <strong>HELP</strong> for help. You can also tell us by phone or email and we will stop. See our{" "}
        <Link href={`${LEGAL_PATHS.terms}#texts`}>texting terms</Link>.
      </p>
      <p>
        <strong>
          We do not sell, rent or share your mobile number or text messaging consent with third parties or affiliates for their
          marketing or promotional purposes.
        </strong>{" "}
        Text messaging originator opt-in data and consent are excluded from every kind of sharing described in this policy, except
        with the texting provider that delivers our messages.
      </p>

      <h2>Who we share it with</h2>
      <p>Only as needed to serve you, and never sold:</p>
      <ul>
        <li><strong>Service providers that run our systems for us:</strong> website hosting (Vercel), our database and file storage (Supabase), calling and texting (Twilio), email delivery (Resend), address lookup (Google Maps), our work calendar (Google Calendar), accounting and invoicing (QuickBooks), and 2Stack Systems, which builds and operates our job management software. They may use your information only to provide their service to us.</li>
        <li><strong>The crews who do the work:</strong> the job address, contact details and job notes they need, including subcontracted crews.</li>
        <li><strong>[CONFIRM OR DELETE] Manufacturers:</strong> if your roof carries a manufacturer warranty, what the manufacturer needs to register it.</li>
        <li><strong>When the law requires it,</strong> or to protect our rights, our customers or the public, and to a buyer if the business is sold.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep requests that never become a job for up to {LEGAL.unconvertedLeadRetention}, then delete them. For customers, we keep job, proposal,
        invoice and warranty records for as long as the warranty lasts and as long as tax, licensing and other laws require.
        Photos and messages are kept with the job they belong to. You can ask us to delete your information sooner, as described below.
      </p>

      <h2>Your choices and rights</h2>
      <p>You can ask us to:</p>
      <ul>
        <li>confirm whether we hold your personal information and give you a copy;</li>
        <li>correct something that is wrong;</li>
        <li>delete your information (we may keep what the law requires us to keep, such as tax and warranty records);</li>
        <li>stop texts, calls or emails.</li>
      </ul>
      <p>
        New Jersey residents may also have rights under the New Jersey Data Privacy Act, including to opt out of the sale of personal
        data, targeted advertising and profiling. We do none of these. We answer requests from anyone, wherever you live, within 45
        days. If we decline a request you can appeal by replying to our answer, and if you are not satisfied you may contact the New
        Jersey Division of Consumer Affairs. We will not treat you differently for using these rights. We may need to confirm your
        identity before acting on a request.
      </p>

      <h2>Security</h2>
      <p>
        Your information is stored with providers that encrypt it in transit and at rest. Only our staff, and the providers above where their service needs it, can access customer records,
        and links we text or email you to a proposal or form are private to you. No system is perfectly secure; if a breach affects
        your information we will tell you as the law requires.
      </p>

      <h2>Children</h2>
      <p>Our services are for adults. We do not knowingly collect information from anyone under 16.</p>

      <h2>Changes</h2>
      <p>If we change this policy we will post the new version here with a new effective date. Material changes apply only going forward.</p>

      <h2>Contact us</h2>
      <p>
        {who.name}
        <br />
        {who.address}
        <br />
        Privacy requests: <a href={`mailto:${email}`}>{email}</a>
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
