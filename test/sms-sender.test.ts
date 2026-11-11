import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_SMS, canSendSms, customerSender, opsSender, senderFor, withSenderName } from "@/lib/outbox/sms-sender";

const business = {
  TWILIO_ACCOUNT_SID: "AC_business",
  TWILIO_API_KEY_SID: "SK_business",
  TWILIO_API_KEY_SECRET: "secret_business",
  TWILIO_MESSAGING_SERVICE_SID: "MG_business",
};
const ops = {
  TWILIO_OPS_ACCOUNT_SID: "AC_ops",
  TWILIO_OPS_API_KEY_SID: "SK_ops",
  TWILIO_OPS_API_KEY_SECRET: "secret_ops",
  TWILIO_OPS_MESSAGING_SERVICE_SID: "MG_ops",
};

const CUSTOMER_KINDS = [
  "request_approved", "proposal_link", "aftercare_warranty", "feedback_request",
  "referral_invite", "referral_earned", "referral_paid", "reply",
];

describe("sms sender", () => {
  it("sends staff alerts on the ops sender, prefixed with its registered brand", () => {
    const env = { ...business, ...ops };
    for (const kind of STAFF_SMS) {
      const sender = senderFor(kind, env);
      expect(sender?.messagingServiceSid).toBe("MG_ops");
      expect(sender?.senderName).toBe("2Stack");
    }
    const sender = senderFor("lead_received", env)!;
    expect(withSenderName(sender, "New roofing lead: Maria Lopez")).toBe("2Stack: New roofing lead: Maria Lopez");
  });

  it("never sends a customer text on the ops sender", () => {
    for (const kind of CUSTOMER_KINDS) {
      expect(STAFF_SMS.has(kind)).toBe(false);
      expect(senderFor(kind, { ...business, ...ops })?.messagingServiceSid).toBe("MG_business");
      expect(senderFor(kind, ops)).toBeNull();
    }
  });

  it("falls back to the business sender, unprefixed, when there is no ops sender", () => {
    const sender = senderFor("request_received", business)!;
    expect(sender.messagingServiceSid).toBe("MG_business");
    expect(withSenderName(sender, "New dumpster request")).toBe("New dumpster request");
  });

  it("needs every ops variable before using the ops sender", () => {
    expect(opsSender({ ...ops, TWILIO_OPS_API_KEY_SECRET: "" })).toBeNull();
    expect(opsSender({ ...ops, TWILIO_OPS_MESSAGING_SERVICE_SID: "  " })).toBeNull();
    expect(senderFor("lead_received", { ...business, ...ops, TWILIO_OPS_ACCOUNT_SID: undefined })?.messagingServiceSid).toBe("MG_business");
  });

  it("takes the sender name from TWILIO_OPS_SENDER_NAME when set", () => {
    expect(opsSender({ ...ops, TWILIO_OPS_SENDER_NAME: "Rake" })?.senderName).toBe("Rake");
    expect(opsSender({ ...ops, TWILIO_OPS_SENDER_NAME: " " })?.senderName).toBe("2Stack");
  });

  it("claims texts when either sender is configured", () => {
    expect(canSendSms({})).toBe(false);
    expect(canSendSms(ops)).toBe(true);
    expect(canSendSms(business)).toBe(true);
    expect(customerSender(ops)).toBeNull();
  });

  it("covers every staff alert the database queues", () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    const staffKinds = [...sql.matchAll(/app\.notify_staff\([^,]+,\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(staffKinds.length).toBeGreaterThan(0);
    for (const kind of staffKinds) expect(STAFF_SMS.has(kind)).toBe(true);
  });
});
