// Which Twilio sender a text goes out on.
//
// Customer texts (dumpster booked, proposal links, review and referral asks,
// inbox replies) always go out on the business's own registered number:
// TWILIO_ACCOUNT_SID / TWILIO_API_KEY_* / TWILIO_MESSAGING_SERVICE_SID.
//
// Staff alerts (new request, new lead, signed proposal, ...) can go out on a
// separate sender, TWILIO_OPS_*: 2Stack's own A2P-registered line. That gets
// the team their alerts before the business's own A2P registration is
// approved, and keeps 2Stack's registration from ever carrying the business's
// customer texts. Ops texts start with the registered brand name ("2Stack: "),
// as carriers expect. Without TWILIO_OPS_*, staff alerts use the business
// sender, unprefixed, exactly as before.
//
// Pure (reads the env it is given) so the routing rule is testable.

/** Texts to the business's own staff (owner and office), never to customers. */
export const STAFF_SMS: ReadonlySet<string> = new Set([
  "request_received",
  "lead_received",
  "text_received",
  "voicemail_received",
  "proposal_signed",
  "feedback_followup",
  "reward_owed",
]);

export type SmsSender = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  messagingServiceSid: string;
  /** Prepended as "Name: " so every text names the brand its number is registered to. */
  senderName: string | null;
};

type Env = Record<string, string | undefined>;

function read(env: Env, prefix: "TWILIO" | "TWILIO_OPS"): Omit<SmsSender, "senderName"> | null {
  const accountSid = env[`${prefix}_ACCOUNT_SID`]?.trim();
  const apiKeySid = env[`${prefix}_API_KEY_SID`]?.trim();
  const apiKeySecret = env[`${prefix}_API_KEY_SECRET`]?.trim();
  const messagingServiceSid = env[`${prefix}_MESSAGING_SERVICE_SID`]?.trim();
  if (!accountSid || !apiKeySid || !apiKeySecret || !messagingServiceSid) return null;
  return { accountSid, apiKeySid, apiKeySecret, messagingServiceSid };
}

/** The business's own number: customer texts, and staff alerts when there is no ops sender. */
export function customerSender(env: Env): SmsSender | null {
  const config = read(env, "TWILIO");
  return config && { ...config, senderName: null };
}

/** 2Stack's registered line, for staff alerts only. */
export function opsSender(env: Env): SmsSender | null {
  const config = read(env, "TWILIO_OPS");
  return config && { ...config, senderName: env.TWILIO_OPS_SENDER_NAME?.trim() || "2Stack" };
}

export function senderFor(kind: string, env: Env): SmsSender | null {
  if (STAFF_SMS.has(kind)) return opsSender(env) ?? customerSender(env);
  return customerSender(env);
}

/** Whether any text can go out at all (the outbox only claims texts when one can). */
export function canSendSms(env: Env): boolean {
  return Boolean(customerSender(env) ?? opsSender(env));
}

export function withSenderName(sender: SmsSender, body: string): string {
  return sender.senderName ? `${sender.senderName}: ${body}` : body;
}
