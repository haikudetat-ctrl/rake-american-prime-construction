import type { StatementView } from "@/lib/billing/statement";
import { formatDate } from "@/lib/dates";
import type { Locale } from "@/lib/i18n";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

// Message wording lives here, as pure functions, so it can be read and
// tested in one place. The outbox payload carries only ids and the few facts
// known when the message was queued.

export type Brand = { name: string; phone: string | null };

export function requestReceivedSms(
  p: { name: string; date: string; address: string; locale?: Locale },
  appUrl: string,
): string {
  const link = `${appUrl}/office/requests`;
  return p.locale === "es"
    ? `Nueva solicitud de contenedor: ${p.name}, ${formatDate(p.date, "es-US")}, ${p.address}. Aprobar: ${link}`
    : `New dumpster request: ${p.name}, ${formatDate(p.date)}, ${p.address}. Approve: ${link}`;
}

const NEED_TEXT: Record<string, { en: string; es: string }> = {
  replacement: { en: "replacement", es: "reemplazo" },
  repair: { en: "repair", es: "reparación" },
  inspection: { en: "inspection", es: "inspección" },
  gutters: { en: "gutters", es: "canaletas" },
  storm: { en: "storm damage", es: "daño por tormenta" },
  other: { en: "roofing", es: "techo" },
};

export function leadReceivedSms(
  p: { leadId: string; name: string; need: string; address: string | null; locale?: Locale },
  appUrl: string,
): string {
  const link = `${appUrl}/office/leads/${p.leadId}`;
  const need = NEED_TEXT[p.need] ?? NEED_TEXT.other;
  const where = p.address ? `, ${p.address}` : "";
  return p.locale === "es"
    ? `Nuevo cliente de techo: ${p.name} (${need.es})${where}. Ver: ${link}`
    : `New roofing lead: ${p.name} (${need.en})${where}. Open: ${link}`;
}

export function textReceivedSms(
  p: { from: string; name: string | null; body: string; locale?: Locale },
  appUrl: string,
): string {
  const who = p.name ? `${p.name} (${formatPhone(p.from)})` : formatPhone(p.from);
  const link = `${appUrl}/office/inbox/${encodeURIComponent(p.from)}`;
  const body = p.body.length > 100 ? `${p.body.slice(0, 100)}…` : p.body;
  return p.locale === "es"
    ? `Texto de ${who}: "${body}" Responder: ${link}`
    : `Text from ${who}: "${body}" Reply: ${link}`;
}

export function voicemailReceivedSms(
  p: { from: string; name: string | null; seconds: number; leadId: string | null; locale?: Locale },
  appUrl: string,
): string {
  const who = p.name ? `${p.name} (${formatPhone(p.from)})` : formatPhone(p.from);
  const link = p.leadId ? `${appUrl}/office/leads/${p.leadId}` : `${appUrl}/office/inbox?tab=calls`;
  return p.locale === "es"
    ? `Buzón de voz de ${who}, ${p.seconds} s. Escuchar: ${link}`
    : `Voicemail from ${who}, ${p.seconds}s. Listen: ${link}`;
}

export function proposalLinkSms(p: { name: string; link: string }, brand: Brand): string {
  const first = p.name.split(/\s+/)[0];
  return `${brand.name}: hi ${first}, your roofing proposal is ready. Review the options and sign here: ${p.link} Reply STOP to opt out.`;
}

export function proposalLinkEmail(p: { name: string; link: string; number: number }, brand: Brand): { subject: string; text: string } {
  return {
    subject: `Your roofing proposal #${p.number} from ${brand.name}`,
    text: [
      `Hi ${p.name.split(/\s+/)[0]},`,
      "",
      "Thanks for having us out. Your proposal is ready: it shows the options we talked about, with prices and warranties.",
      "You can pick an option and sign right on your phone:",
      "",
      p.link,
      "",
      "Questions? Just reply to this email" + (brand.phone ? ` or call ${formatPhone(brand.phone)}.` : "."),
      "",
      brand.name,
    ].join("\n"),
  };
}

export function proposalSignedEmail(p: { name: string; number: number; option: string; totalCents: number }, brand: Brand): { subject: string; text: string } {
  return {
    subject: `Signed: roofing agreement #${p.number} with ${brand.name}`,
    text: [
      `Hi ${p.name.split(/\s+/)[0]},`,
      "",
      `Thank you! You signed for ${p.option}, total ${formatCents(p.totalCents)}. Your signed copy is attached.`,
      "We'll be in touch to schedule the work.",
      "",
      brand.name,
      brand.phone ? formatPhone(brand.phone) : "",
    ].join("\n").trimEnd(),
  };
}

export function proposalSignedSms(p: { name: string; option: string; totalCents: number; leadId: string; locale?: Locale }, appUrl: string): string {
  const link = `${appUrl}/office/leads/${p.leadId}`;
  return p.locale === "es"
    ? `¡Firmado! ${p.name}: ${p.option}, ${formatCents(p.totalCents)}. ${link}`
    : `Signed! ${p.name}: ${p.option}, ${formatCents(p.totalCents)}. ${link}`;
}

export function requestApprovedSms(p: { date: string; address: string }, brand: Brand): string {
  const contact = brand.phone ? ` Changes? Call ${formatPhone(brand.phone)}.` : "";
  return `${brand.name}: your dumpster is booked for ${formatDate(p.date)} at ${p.address}.${contact} Reply STOP to opt out.`;
}

export function statementEmail(s: StatementView): { subject: string; text: string } {
  const jobs = s.invoices.map((i) => `  #${i.number}  ${i.address}  ${formatCents(i.totalCents)}`).join("\n");
  return {
    subject: `Statement #${s.number} from ${s.brand.name}: ${formatCents(s.balanceCents)} due ${formatDate(s.dueOn)}`,
    text: [
      `Hi ${s.customer.name},`,
      "",
      `Here is this week's statement for dumpster rentals. The PDF is attached.`,
      "",
      jobs,
      "",
      `Total due: ${formatCents(s.balanceCents)} by ${formatDate(s.dueOn)}.`,
      `Pay by check to ${s.brand.name}${s.brand.address ? ` (${s.brand.address})` : ""} or ACH — reply for bank details.`,
      "",
      `Thank you,`,
      s.brand.name,
      s.brand.phone ? formatPhone(s.brand.phone) : "",
    ]
      .join("\n")
      .trimEnd(),
  };
}

export function reminderEmail(s: StatementView, daysOverdue: number): { subject: string; text: string } {
  return {
    subject: `Reminder: statement #${s.number} from ${s.brand.name} is past due`,
    text: [
      `Hi ${s.customer.name},`,
      "",
      `Statement #${s.number} was due ${formatDate(s.dueOn)} and is now ${daysOverdue} days past due.`,
      `Balance: ${formatCents(s.balanceCents)}. The statement is attached again for your records.`,
      "",
      `If you've already sent payment, thank you — please disregard this note.`,
      "",
      s.brand.name,
      s.brand.phone ? formatPhone(s.brand.phone) : "",
    ]
      .join("\n")
      .trimEnd(),
  };
}
