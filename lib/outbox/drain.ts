import "server-only";
import { loadStatement } from "@/lib/billing/statement";
import { isLocale } from "@/lib/i18n";
import { sendEmail } from "@/lib/integrations/resend";
import { SmsProviderError, TwilioMessagingClient } from "@/lib/integrations/twilio";
import {
  aftercareWarrantyEmail,
  aftercareWarrantySms,
  feedbackFollowupSms,
  feedbackRequestSms,
  leadReceivedSms,
  proposalLinkEmail,
  proposalLinkSms,
  proposalSignedEmail,
  proposalSignedSms,
  referralEarnedSms,
  referralInviteSms,
  referralPaidSms,
  reminderEmail,
  requestApprovedSms,
  rewardOwedSms,
  requestReceivedSms,
  statementEmail,
  textReceivedSms,
  voicemailReceivedSms,
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
  attempts: number;
  max_attempts: number;
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

async function roofingBrand(companyId: string): Promise<Brand & { email: string | null }> {
  const { data } = await adminClient()
    .from("brands")
    .select("display_name, phone, email")
    .eq("company_id", companyId)
    .eq("kind", "roofing")
    .single();
  return { name: data?.display_name ?? "American Prime Construction", phone: data?.phone ?? null, email: data?.email ?? null };
}

/** Proposal emails: the link to review and sign, and the signed copy with its PDF. */
async function deliverProposalEmail(message: OutboxMessage, email: { apiKey: string; from: string }, appUrl: string) {
  const p = message.payload;
  const { loadFullProposal } = await import("@/lib/proposals/server");
  const proposal = await loadFullProposal({ id: String(p.proposal_id) });
  if (!proposal) throw new Skip("proposal not found");
  const brand = await roofingBrand(message.company_id);
  if (message.kind === "proposal_link") {
    if (proposal.status !== "sent") throw new Skip(`proposal is ${proposal.status}`);
    const content = proposalLinkEmail({ name: String(p.name), number: proposal.content.number, link: `${appUrl}/p/${p.token}` }, brand);
    await sendEmail({ apiKey: email.apiKey, from: `${brand.name} <${email.from}>`, to: String(p.to), replyTo: brand.email, ...content });
    return;
  }
  if (!proposal.signature) throw new Skip("not signed");
  const { proposalPdf } = await import("@/lib/proposals/pdf");
  if (message.kind === "aftercare_warranty") {
    const content = aftercareWarrantyEmail(
      { name: proposal.lead.name, system: proposal.signature.option.name, warranty: proposal.signature.option.warranty },
      brand,
    );
    await sendEmail({
      apiKey: email.apiKey, from: `${brand.name} <${email.from}>`, to: String(p.to), replyTo: brand.email, ...content,
      attachments: [{ filename: `agreement-${proposal.content.number}.pdf`, content: await proposalPdf(proposal) }],
    });
    return;
  }
  const content = proposalSignedEmail(
    { name: proposal.lead.name, number: proposal.content.number, option: proposal.signature.option.name, totalCents: proposal.signature.totalCents },
    brand,
  );
  await sendEmail({
    apiKey: email.apiKey,
    from: `${brand.name} <${email.from}>`,
    to: String(p.to),
    replyTo: brand.email,
    ...content,
    attachments: [{ filename: `agreement-${proposal.content.number}.pdf`, content: await proposalPdf(proposal) }],
  });
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

/** Texts to customers (not staff alerts): never sent to a number that replied STOP. */
const CUSTOMER_SMS = new Set([
  "request_approved", "proposal_link", "aftercare_warranty", "feedback_request", "referral_invite", "referral_earned", "referral_paid",
]);

async function optedOut(companyId: string, phone: string): Promise<boolean> {
  const { data } = await adminClient()
    .from("sms_opt_outs").select("phone").eq("company_id", companyId).eq("phone", phone).is("opted_in_at", null).maybeSingle();
  return Boolean(data);
}

/** Twilio errors that will never succeed on retry: opted out, not a mobile number, invalid number. */
const PERMANENT_SMS_ERRORS = new Set(["21610", "21614", "21211", "21612", "21408"]);

/** An office reply from the inbox: send it and record the outcome on the message. */
async function sendReply(sms: NonNullable<ReturnType<typeof smsClient>>, message: OutboxMessage): Promise<void> {
  const p = message.payload;
  const db = adminClient();
  const { data: optedOut } = await db
    .from("sms_opt_outs")
    .select("phone")
    .eq("company_id", message.company_id)
    .eq("phone", String(p.to))
    .is("opted_in_at", null)
    .maybeSingle();
  if (optedOut) {
    await db.rpc("mark_text_sent", { p_message_id: p.message_id, p_twilio_sid: null, p_error: "They replied STOP." });
    throw new Skip("recipient opted out");
  }
  try {
    const sent = await sms.client.send({
      messagingServiceSid: sms.messagingServiceSid,
      to: String(p.to),
      body: String(p.body),
      statusCallback: null,
    });
    await db.rpc("mark_text_sent", { p_message_id: p.message_id, p_twilio_sid: sent.sid, p_error: null });
  } catch (err) {
    if (err instanceof SmsProviderError && err.code && PERMANENT_SMS_ERRORS.has(err.code)) {
      await db.rpc("mark_text_sent", { p_message_id: p.message_id, p_twilio_sid: null, p_error: err.message });
      throw new Skip(`twilio ${err.code}`);
    }
    throw err;
  }
}

async function deliver(message: OutboxMessage): Promise<void> {
  const p = message.payload;
  const appUrl = process.env.APP_URL ?? "";

  if (message.channel === "sms") {
    const sms = smsClient();
    if (!sms) throw new Error("SMS not configured");
    if (CUSTOMER_SMS.has(message.kind) && (await optedOut(message.company_id, String(p.to)))) {
      throw new Skip("recipient replied STOP");
    }
    let body: string;
    if (message.kind === "request_received") {
      body = requestReceivedSms(
        { name: String(p.name), date: String(p.date), address: String(p.address), locale: isLocale(p.locale) ? p.locale : "en" },
        appUrl,
      );
    } else if (message.kind === "lead_received") {
      body = leadReceivedSms(
        {
          leadId: String(p.lead_id),
          name: String(p.name),
          need: String(p.need),
          address: p.address ? String(p.address) : null,
          locale: isLocale(p.locale) ? p.locale : "en",
        },
        appUrl,
      );
    } else if (message.kind === "text_received") {
      body = textReceivedSms(
        { from: String(p.from), name: p.name ? String(p.name) : null, body: String(p.body ?? ""), locale: isLocale(p.locale) ? p.locale : "en" },
        appUrl,
      );
    } else if (message.kind === "voicemail_received") {
      body = voicemailReceivedSms(
        {
          from: String(p.from),
          name: p.name ? String(p.name) : null,
          seconds: Number(p.seconds ?? 0),
          leadId: p.lead_id ? String(p.lead_id) : null,
          locale: isLocale(p.locale) ? p.locale : "en",
        },
        appUrl,
      );
    } else if (message.kind === "proposal_link") {
      body = proposalLinkSms({ name: String(p.name), link: `${appUrl}/p/${p.token}` }, await roofingBrand(message.company_id));
    } else if (message.kind === "proposal_signed") {
      body = proposalSignedSms(
        {
          name: String(p.name), option: String(p.option), totalCents: Number(p.total_cents), leadId: String(p.lead_id),
          locale: isLocale(p.locale) ? p.locale : "en",
        },
        appUrl,
      );
    } else if (message.kind === "aftercare_warranty") {
      body = aftercareWarrantySms(
        { name: String(p.name), system: String(p.system), link: p.proposal_token ? `${appUrl}/p/${p.proposal_token}` : null },
        await roofingBrand(message.company_id),
      );
    } else if (message.kind === "feedback_request") {
      body = feedbackRequestSms({ name: String(p.name), link: `${appUrl}/f/${p.token}` }, await roofingBrand(message.company_id));
    } else if (message.kind === "referral_invite") {
      body = referralInviteSms(
        { name: String(p.name), link: `${appUrl}/r/${p.code}`, rewardCents: Number(p.reward_cents) },
        await roofingBrand(message.company_id),
      );
    } else if (message.kind === "referral_earned") {
      body = referralEarnedSms({ name: String(p.name), friend: String(p.friend), rewardCents: Number(p.reward_cents) }, await roofingBrand(message.company_id));
    } else if (message.kind === "referral_paid") {
      body = referralPaidSms(
        { name: String(p.name), friend: String(p.friend), rewardCents: Number(p.reward_cents), method: String(p.method) },
        await roofingBrand(message.company_id),
      );
    } else if (message.kind === "feedback_followup") {
      body = feedbackFollowupSms({ name: String(p.name), rating: String(p.rating), comment: String(p.comment ?? ""), jobId: String(p.job_id) }, appUrl);
    } else if (message.kind === "reward_owed") {
      body = rewardOwedSms({ referrer: String(p.referrer), friend: String(p.friend), rewardCents: Number(p.reward_cents) }, appUrl);
    } else if (message.kind === "reply") {
      await sendReply(sms, message);
      return;
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
  if (message.kind === "proposal_link" || message.kind === "proposal_signed" || message.kind === "aftercare_warranty") {
    await deliverProposalEmail(message, email, appUrl);
    return;
  }
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
        const reason = (err as Error).message.slice(0, 500);
        await db.rpc("finish_outbox", { p_id: message.id, p_error: reason });
        // Last try for an inbox reply: show it as failed in the thread instead of "sending".
        if (message.kind === "reply" && message.attempts >= message.max_attempts) {
          await db.rpc("mark_text_sent", { p_message_id: message.payload.message_id, p_twilio_sid: null, p_error: reason });
        }
        failed++;
      }
    }
  }
  return { claimed: messages.length, sent, failed, skipped, channels };
}
