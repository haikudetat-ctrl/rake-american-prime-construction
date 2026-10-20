import "server-only";
import { NextResponse } from "next/server";
import { validTwilioSignature } from "@/lib/phone/twiml";
import { adminClient } from "@/lib/supabase/admin";

export type PhoneSettings = {
  businessNumber: string | null;
  ringNumbers: string[];
  ringSeconds: number;
  openDays: number[];
  openTime: string;
  closeTime: string;
  greeting: string;
  afterHoursGreeting: string;
  notifyTexts: boolean;
};

const DEFAULTS: PhoneSettings = {
  businessNumber: null,
  ringNumbers: [],
  ringSeconds: 20,
  openDays: [1, 2, 3, 4, 5, 6],
  openTime: "08:00",
  closeTime: "18:00",
  greeting:
    "Thanks for calling American Prime Construction. We can't get to the phone right now. Please leave your name, address and what you need after the tone, and we'll call you back.",
  afterHoursGreeting:
    "Thanks for calling American Prime Construction. We're closed right now. Please leave your name, address and what you need after the tone, and we'll call you back first thing.",
  notifyTexts: true,
};

/** Settings for the company that owns `number` (the one called or texted), with defaults. */
export async function loadPhoneSettings(by: { companyId: string } | { number: string }): Promise<PhoneSettings & { companyId: string | null }> {
  const db = adminClient();
  let query = db.from("phone_settings").select("*");
  query = "companyId" in by ? query.eq("company_id", by.companyId) : query.eq("business_number", by.number);
  const { data } = await query.maybeSingle();
  if (!data) {
    const companyId = "companyId" in by
      ? by.companyId
      : ((await db.from("companies").select("id").order("created_at").limit(1).maybeSingle()).data?.id ?? null);
    return { ...DEFAULTS, companyId };
  }
  return {
    companyId: data.company_id,
    businessNumber: data.business_number,
    ringNumbers: data.ring_numbers ?? [],
    ringSeconds: data.ring_seconds,
    openDays: data.open_days ?? [],
    openTime: String(data.open_time).slice(0, 5),
    closeTime: String(data.close_time).slice(0, 5),
    greeting: data.greeting,
    afterHoursGreeting: data.after_hours_greeting,
    notifyTexts: data.notify_texts,
  };
}

/** Absolute URL for one of our webhook routes (what Twilio is told, and what it signs). */
export function webhookUrl(path: string): string {
  return `${(process.env.APP_URL ?? "").replace(/\/$/, "")}${path}`;
}

/**
 * Reads a Twilio webhook POST and checks its signature against the URL Twilio
 * was given (APP_URL + path + query). Returns the parameters, or a 403
 * response for anything Twilio didn't sign.
 */
export async function readTwilioRequest(req: Request): Promise<{ params: Record<string, string> } | { denied: NextResponse }> {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return { denied: new NextResponse("Phone not configured", { status: 503 }) };
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
  const url = new URL(req.url);
  const signed = webhookUrl(`${url.pathname}${url.search}`);
  if (!validTwilioSignature(token, signed, params, req.headers.get("x-twilio-signature"))) {
    return { denied: new NextResponse("Invalid signature", { status: 403 }) };
  }
  return { params };
}

export function twiml(body: string): NextResponse {
  return new NextResponse(body, { headers: { "content-type": "text/xml; charset=utf-8" } });
}

/** Basic auth for Twilio's REST API (recordings and media), using the API key. */
export function twilioAuthHeader(): string | null {
  const { TWILIO_API_KEY_SID: sid, TWILIO_API_KEY_SECRET: secret } = process.env;
  return sid && secret ? `Basic ${Buffer.from(`${sid}:${secret}`).toString("base64")}` : null;
}
