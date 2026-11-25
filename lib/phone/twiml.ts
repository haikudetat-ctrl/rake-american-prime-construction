import { createHmac, timingSafeEqual } from "node:crypto";
import { COMPANY_TIMEZONE } from "@/lib/dates";

// Pure pieces of the business phone: Twilio request signatures, TwiML, hours.
// No I/O here, so it is unit-tested.

/**
 * Twilio's X-Twilio-Signature: base64 HMAC-SHA1, keyed with the account auth
 * token, over the full URL Twilio requested followed by every POST parameter
 * as name+value, sorted by name.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const xml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

export const emptyTwiml = () => doc("");
export const hangupTwiml = () => doc("<Hangup/>");

/**
 * Ring every number at once. Each answering phone first hears the screen
 * (press 1), so a personal voicemail that picks up can't take the call.
 * callerId is the business number, so staff phones see a business call (not
 * a personal one they might auto-reply to); the screen says who is calling.
 */
export function ringTwiml(p: {
  numbers: string[];
  callerId: string;
  timeoutSeconds: number;
  screenUrl: string;
  doneUrl: string;
}): string {
  const numbers = p.numbers.map((n) => `<Number url="${xml(p.screenUrl)}" method="POST">${xml(n)}</Number>`).join("");
  return doc(
    `<Dial timeout="${p.timeoutSeconds}" answerOnBridge="true" callerId="${xml(p.callerId)}" action="${xml(p.doneUrl)}" method="POST">${numbers}</Dial>`,
  );
}

/**
 * A phone number as speech: US numbers in 3-3-4 groups ("6 0 9, 5 5 5, 0 1 0 0"),
 * anything else digit by digit. Null when there are no digits (a blocked or
 * anonymous caller).
 */
// What Twilio puts in From for anonymous, restricted, blocked and unavailable callers.
const HIDDEN_CALLER = new Set(["266696687", "7378742833", "2562533", "8656696"]);

export function spokenNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits || HIDDEN_CALLER.has(digits)) return null;
  const us = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const spell = (d: string) => d.split("").join(" ");
  if (us.length === 10) return `${spell(us.slice(0, 3))}, ${spell(us.slice(3, 6))}, ${spell(us.slice(6))}`;
  return spell(digits);
}

/** Placeholder names Rake gives a stranger's lead ("New caller +1609…"); not worth saying. */
const PLACEHOLDER_NAME = /^new (caller|texter)\b/i;

/**
 * Who to announce on the screen: the lead's (or customer's) name when it's a
 * real one, else the number read out, else "a blocked number". The name is
 * cleaned of control characters and capped, so odd data can't make the
 * whisper run on; xml() escapes it when it goes into TwiML.
 */
export function callerAnnouncement(p: { name?: string | null; phone?: string | null }): string {
  const name = (p.name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  if (name && /\p{L}/u.test(name) && !PLACEHOLDER_NAME.test(name)) return name;
  return spokenNumber(p.phone) ?? "a blocked number";
}

/** Played to whoever picks up, before they're connected: which business, who's calling. */
export function screenTwiml(p: { brandName: string; caller?: string | null; doneUrl: string }): string {
  const from = p.caller ? ` from ${xml(p.caller)}` : "";
  return doc(
    `<Gather numDigits="1" timeout="6" action="${xml(p.doneUrl)}" method="POST"><Say>Call for ${xml(p.brandName)}${from}. Press 1 to answer.</Say></Gather><Hangup/>`,
  );
}

/** Greeting, then up to three minutes of voicemail. */
export function voicemailTwiml(p: { greeting: string; doneUrl: string; recordingUrl: string }): string {
  return doc(
    `<Say>${xml(p.greeting)}</Say><Record maxLength="180" playBeep="true" action="${xml(p.doneUrl)}" method="POST" recordingStatusCallback="${xml(p.recordingUrl)}" recordingStatusCallbackMethod="POST"/><Say>We didn't get a message. Goodbye.</Say>`,
  );
}

export type Hours = { openDays: number[]; openTime: string; closeTime: string };

/** Whether the business answers calls now (company timezone; days are ISO, 1 = Monday). */
export function isOpen(hours: Hours, now: Date = new Date(), timeZone = COMPANY_TIMEZONE): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return hours.openDays.includes(day) && minutes >= toMinutes(hours.openTime) && minutes < toMinutes(hours.closeTime);
}

/** Twilio's DialCallStatus after the ring list: did someone take the call? */
export const dialAnswered = (status: string | undefined) => status === "completed" || status === "answered";
