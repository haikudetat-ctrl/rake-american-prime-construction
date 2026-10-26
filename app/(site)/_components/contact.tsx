import { formatPhone } from "@/lib/phone";
import type { BrandContact } from "@/lib/site/content";
import s from "../site.module.css";

/**
 * Phone and email links for a brand, as saved in Rake Settings. Renders
 * nothing until the office fills them in, so the page never shows a
 * placeholder number.
 */
export function ContactLinks({
  contact,
  tone = "light",
  text = false,
}: {
  contact: BrandContact;
  tone?: "light" | "dark";
  /** Offer "Text" next to "Call": right for contractors, who text more than they call. */
  text?: boolean;
}) {
  if (!contact.phone && !contact.email) return null;
  const ghost = tone === "dark" ? s.btnOnDark : s.btnGhost;
  return (
    <>
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className={ghost}>
          Call {formatPhone(contact.phone)}
        </a>
      )}
      {contact.phone && text && (
        <a href={`sms:${contact.phone}`} className={ghost}>
          Text us
        </a>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={ghost}>
          Email {contact.email}
        </a>
      )}
    </>
  );
}
