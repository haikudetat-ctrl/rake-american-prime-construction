import "server-only";
import { loadStatement } from "@/lib/billing/statement";
import { isLocale } from "@/lib/i18n";
import { sendEmail } from "@/lib/integrations/resend";
import { TwilioMessagingClient } from "@/lib/integrations/twilio";
import {
  reminderEmail,
  requestApprovedSms,
  requestReceivedSms,
  statementEmail,
  type Brand,
} from "@/lib/outbox/messages";
import { renderStatementPdf } from "@/lib/pdf/render";
import { adminClient } from "@/lib/supabase/admin";

type OutboxMessage = {
  id: string;
  company_id: string;
  channel: "sms" | "email";
  kind: string;
  payload: Record<string, unknown>;
};

class Skip extends Error {}

function smsClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_MESSAGING_SERVICE_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_MESSAGING_SERVICE_SID) return null;
  return {
    client: new TwilioMessagingClient({
      accountSid: TWILIO_ACCOUNT_SID,
      apiKeySid: TWILIO_API_KEY_SID,
      apiKeySecret: TWILIO_API_KEY_SECRET,
    }),
    messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
  };
}

function emailConfig() {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  return RESEND_API_KEY && EMAIL_FROM ? { apiKey: RESEND_API_KEY, from: EMAIL_FROM } : null;
}

async function dumpsterBrand(companyId: string): Promise<Brand & { email: string | null }> {
  const { data } = await adminClient()
    .from("brands")
    .select("display_name, phone, email")
    .eq("company_id", companyId)
    .eq("kind", "dumpster")
    .single();
  return { name: data?.display_name ?? "American Prime Construction", phone: data?.phone ?? null, email: data?.email ?? null };
}

async function deliver(message: OutboxMessage): Promise<void> {
  const p = message.payload;
  const appUrl = process.env.APP_URL ?? "";

  if (message.channel === "sms") {
    const sms = smsClient();
    if (!sms) throw new Error("SMS not configured");
    let body: string;
    if (message.kind === "request_received") {
      body = requestReceivedSms(
        { name: String(p.name), date: String(p.date), address: String(p.address), locale: isLocale(p.locale) ? p.locale : "en" },
        appUrl,
      );
    } else if (message.kind === "request_approved") {
      body = requestApprovedSms({ date: String(p.date), address: String(p.address) }, await dumpsterBrand(message.company_id));
    } else {
      throw new Skip(`unknown sms kind ${message.kind}`);
    }
    await sms.client.send({ messagingServiceSid: sms.messagingServiceSid, to: String(p.to), body, statusCallback: null });
    return;
  }

  const email = emailConfig();
  if (!email) throw new Error("Email not configured");
  const statement = await loadStatement(adminClient(), String(p.statement_id));
  if (!statement) throw new Skip("statement not found");
  if (message.kind === "statement_reminder" && statement.status !== "open") throw new Skip("statement no longer open");

  const content =
    message.kind === "statement_issued"
      ? statementEmail(statement)
      : message.kind === "statement_reminder"
        ? reminderEmail(statement, Number(p.days_overdue))
        : null;
  if (!content) throw new Skip(`unknown email kind ${message.kind}`);

  const brand = await dumpsterBrand(message.company_id);
  await sendEmail({
    apiKey: email.apiKey,
    from: `${statement.brand.name} <${email.from}>`,
    to: String(p.to),
    replyTo: brand.email,
    subject: content.subject,
    text: content.text,
    attachments: [{ filename: `statement-${statement.number}.pdf`, content: await renderStatementPdf(statement) }],
  });
  if (message.kind === "statement_issued") {
    await adminClient().from("statements").update({ sent_at: new Date().toISOString() }).eq("id", statement.id);
  }
}

/**
 * Delivers due outbox messages. Channels without credentials are not claimed,
 * so their messages wait instead of failing.
 */
export async function drainOutbox(batchSize = 20) {
  const channels = [smsClient() && "sms", emailConfig() && "email"].filter(Boolean) as string[];
  if (channels.length === 0) return { claimed: 0, sent: 0, failed: 0, skipped: 0, channels };

  const db = adminClient();
  const { data, error } = await db.rpc("claim_outbox", { batch_size: batchSize, channels });
  if (error) throw new Error(`claim_outbox failed: ${error.message}`);
  const messages = (data ?? []) as OutboxMessage[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const message of messages) {
    try {
      await deliver(message);
      await db.rpc("finish_outbox", { p_id: message.id, p_error: null });
      sent++;
    } catch (err) {
      if (err instanceof Skip) {
        // Nothing to send (paid before the reminder went out, etc.): close it.
        await db.from("outbox_messages").update({ status: "sent", last_error: `skipped: ${err.message}`, locked_at: null }).eq("id", message.id);
        skipped++;
      } else {
        await db.rpc("finish_outbox", { p_id: message.id, p_error: (err as Error).message.slice(0, 500) });
        failed++;
      }
    }
  }
  return { claimed: messages.length, sent, failed, skipped, channels };
}
