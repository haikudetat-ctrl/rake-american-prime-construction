import { xml } from "@/lib/phone/twiml";

// Calls out from the business number (Nov 23): pure pieces, unit-tested.
//
// Rake rings the staff member's own phone first. They hear who they're about
// to call and press 1, and only then does Twilio dial the customer, showing the
// business number as caller ID. Pressing 1 keeps a voicemail that picks up the
// first leg from ever reaching the customer.

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

/** The form Twilio's Calls API takes to ring the staff member's phone. */
export function bridgeCallForm(p: { staffPhone: string; businessNumber: string; url: string; statusCallback: string }): URLSearchParams {
  return new URLSearchParams({
    To: p.staffPhone,
    From: p.businessNumber,
    Url: p.url,
    Method: "POST",
    StatusCallback: p.statusCallback,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "completed",
    Timeout: "25",
  });
}

/** What the staff member hears when they pick up. */
export function outboundScreenTwiml(p: { name: string; connectUrl: string }): string {
  return doc(
    `<Gather numDigits="1" timeout="8" action="${xml(p.connectUrl)}" method="POST"><Say>Calling ${xml(p.name)}. Press 1 to connect.</Say></Gather><Say>No key pressed. Goodbye.</Say><Hangup/>`,
  );
}

/** After they press 1: dial the customer from the business number. */
export function outboundDialTwiml(p: { customer: string; businessNumber: string; doneUrl: string }): string {
  return doc(
    `<Dial callerId="${xml(p.businessNumber)}" timeout="30" answerOnBridge="true" action="${xml(p.doneUrl)}" method="POST"><Number>${xml(p.customer)}</Number></Dial>`,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lead id carried on the webhook URL (Twilio signs the URL, so it can't be swapped). */
export function leadParam(url: string): string | null {
  const id = new URL(url).searchParams.get("lead");
  return id && UUID.test(id) ? id : null;
}
