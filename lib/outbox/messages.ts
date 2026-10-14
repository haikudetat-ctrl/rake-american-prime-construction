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
