import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { textReceivedSms, voicemailReceivedSms } from "@/lib/outbox/messages";
import { groupThreads } from "@/lib/phone/inbox";
import {
  dialAnswered,
  isOpen,
  ringTwiml,
  screenTwiml,
  twilioSignature,
  validTwilioSignature,
  voicemailTwiml,
} from "@/lib/phone/twiml";

describe("Twilio request signature", () => {
  const url = "https://app.example/api/twilio/sms";
  const params = { To: "+16095559999", From: "+16095550100", Body: "Hi & bye", MessageSid: "SM1" };

  it("is HMAC-SHA1 over the URL plus params sorted by name", () => {
    const manual = createHmac("sha1", "token")
      .update(`${url}Body${params.Body}From${params.From}MessageSid${params.MessageSid}To${params.To}`)
      .digest("base64");
    expect(twilioSignature("token", url, params)).toBe(manual);
  });

  it("accepts the right signature and rejects tampering", () => {
    const sig = twilioSignature("token", url, params);
    expect(validTwilioSignature("token", url, params, sig)).toBe(true);
    expect(validTwilioSignature("token", url, { ...params, Body: "changed" }, sig)).toBe(false);
    expect(validTwilioSignature("other", url, params, sig)).toBe(false);
    expect(validTwilioSignature("token", `${url}?x=1`, params, sig)).toBe(false);
    expect(validTwilioSignature("token", url, params, null)).toBe(false);
  });
});

describe("TwiML", () => {
  it("rings every number at once with screening and caller ID passed through", () => {
    const xml = ringTwiml({
      numbers: ["+16095550001", "+16095550002"],
      callerId: "+16095550100",
      timeoutSeconds: 20,
      screenUrl: "https://app/screen",
      doneUrl: "https://app/done",
    });
    expect(xml).toContain('<Dial timeout="20" answerOnBridge="true" callerId="+16095550100" action="https://app/done" method="POST">');
    expect(xml.match(/<Number url="https:\/\/app\/screen" method="POST">/g)).toHaveLength(2);
  });

  it("escapes text the owner typed", () => {
    expect(screenTwiml({ brandName: "A&B <Roofing>", doneUrl: "https://app/x" })).toContain("Call for A&amp;B &lt;Roofing&gt;.");
    const vm = voicemailTwiml({ greeting: `We're "closed"`, doneUrl: "https://app/d", recordingUrl: "https://app/r" });
    expect(vm).toContain("<Say>We&apos;re &quot;closed&quot;</Say>");
    expect(vm).toContain('recordingStatusCallback="https://app/r"');
  });

  it("treats completed or answered as picked up", () => {
    expect(dialAnswered("completed")).toBe(true);
    expect(dialAnswered("no-answer")).toBe(false);
    expect(dialAnswered("busy")).toBe(false);
    expect(dialAnswered(undefined)).toBe(false);
  });
});

describe("business hours", () => {
  const hours = { openDays: [1, 2, 3, 4, 5], openTime: "08:00", closeTime: "18:00" };
  it("uses New York time", () => {
    expect(isOpen(hours, new Date("2026-10-20T12:30:00Z"))).toBe(true); // Tue 8:30 EDT
    expect(isOpen(hours, new Date("2026-10-20T11:59:00Z"))).toBe(false); // Tue 7:59
    expect(isOpen(hours, new Date("2026-10-20T22:00:00Z"))).toBe(false); // Tue 18:00, closed
    expect(isOpen(hours, new Date("2026-10-24T15:00:00Z"))).toBe(false); // Saturday
    expect(isOpen(hours, new Date("2026-12-01T13:30:00Z"))).toBe(true); // Tue 8:30 EST
  });
});

describe("inbox threads", () => {
  it("groups by number, newest first, counting unread", () => {
    const row = (phone: string, at: string, direction: "in" | "out", read: boolean, name: string | null = null) => ({
      phone, body: `${phone} ${at}`, direction, read_at: read ? at : null, created_at: at,
      lead_id: name ? "L" : null, customer_id: null, leads: name ? { name } : null, customers: null,
    });
    const threads = groupThreads([
      row("+1A", "2026-10-20T10:00:00Z", "in", false, "Pat"),
      row("+1B", "2026-10-20T12:00:00Z", "out", true),
      row("+1A", "2026-10-20T11:00:00Z", "in", false),
      row("+1A", "2026-10-20T09:00:00Z", "in", true),
    ]);
    expect(threads.map((t) => t.phone)).toEqual(["+1B", "+1A"]);
    expect(threads[1]).toMatchObject({ name: "Pat", unread: 2, lastAt: "2026-10-20T11:00:00Z" });
  });
});

describe("staff alerts", () => {
  it("text alert links to the thread", () => {
    expect(textReceivedSms({ from: "+16095550100", name: "Pat", body: "Is Thursday ok?" }, "https://app"))
      .toBe('Text from Pat ((609) 555-0100): "Is Thursday ok?" Reply: https://app/office/inbox/%2B16095550100');
  });
  it("voicemail alert links to the lead", () => {
    expect(voicemailReceivedSms({ from: "+16095550100", name: null, seconds: 22, leadId: "L1" }, "https://app"))
      .toBe("Voicemail from (609) 555-0100, 22s. Listen: https://app/office/leads/L1");
  });
});
