import "server-only";
// Adapted from PIW src/modules/sms/twilio.ts (send only; inbound texting is Phase 2).
import { z } from "zod";

export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

const sendResponseSchema = z.object({ sid: z.string().regex(/^(SM|MM)[0-9a-fA-F]{32}$/), status: z.string() }).passthrough();
const errorResponseSchema = z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).passthrough();

type TwilioMessagingOptions = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class TwilioMessagingClient {
  private readonly url: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TwilioMessagingOptions) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(options.accountSid) || !/^SK[0-9a-fA-F]{32}$/.test(options.apiKeySid) || !options.apiKeySecret) {
      throw new SmsProviderError("Twilio credentials are not configured");
    }
    this.url = `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`;
    this.authorization = `Basic ${Buffer.from(`${options.apiKeySid}:${options.apiKeySecret}`, "utf8").toString("base64")}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(input: { messagingServiceSid: string; to: string; body: string; statusCallback: string | null }) {
    const form = new URLSearchParams({ MessagingServiceSid: input.messagingServiceSid, To: input.to, Body: input.body });
    if (input.statusCallback) form.set("StatusCallback", input.statusCallback);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          authorization: this.authorization,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: form.toString(),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      throw new SmsProviderError("Twilio could not be reached");
    } finally {
      clearTimeout(timeout);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorResponseSchema.safeParse(payload);
      const code = error.success && error.data.code !== undefined ? String(error.data.code) : String(response.status);
      throw new SmsProviderError(error.success && error.data.message ? error.data.message : "Twilio rejected the message", code);
    }
    const parsed = sendResponseSchema.safeParse(payload);
    if (!parsed.success) throw new SmsProviderError("Twilio returned an unexpected response");
    return { sid: parsed.data.sid, status: parsed.data.status };
  }
}
