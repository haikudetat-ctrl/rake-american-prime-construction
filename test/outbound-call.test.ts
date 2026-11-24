import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeCallForm, leadParam, outboundDialTwiml, outboundScreenTwiml } from "@/lib/phone/outbound";
import { startBridgeCall } from "@/lib/phone/server";

const LEAD = "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

describe("calling out from the business number (Nov 23)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rings the staff phone from the business number, with the webhook and a status callback", () => {
    const form = bridgeCallForm({
      staffPhone: "+16095550199",
      businessNumber: "+16095550100",
      url: `https://app.example/api/twilio/voice/outbound?lead=${LEAD}`,
      statusCallback: "https://app.example/api/twilio/voice/outbound/status",
    });
    expect(form.get("To")).toBe("+16095550199");
    expect(form.get("From")).toBe("+16095550100");
    expect(form.get("Url")).toBe(`https://app.example/api/twilio/voice/outbound?lead=${LEAD}`);
    expect(form.get("StatusCallbackEvent")).toBe("completed");
  });

  it("says who's being called and waits for 1, escaping the name", () => {
    const xml = outboundScreenTwiml({ name: "Pat & Sam <O'Neil>", connectUrl: "https://app.example/c?lead=1&x=2" });
    expect(xml).toContain('<Gather numDigits="1"');
    expect(xml).toContain("Calling Pat &amp; Sam &lt;O&apos;Neil&gt;. Press 1 to connect.");
    expect(xml).toContain('action="https://app.example/c?lead=1&amp;x=2"');
    expect(xml).toContain("<Hangup/>");
  });

  it("dials the customer with the business number as caller ID", () => {
    const xml = outboundDialTwiml({ customer: "+16095550123", businessNumber: "+16095550100", doneUrl: "https://app.example/d" });
    expect(xml).toContain('callerId="+16095550100"');
    expect(xml).toContain("<Number>+16095550123</Number>");
    expect(xml).toContain('action="https://app.example/d"');
  });

  it("only takes a real lead id from the webhook URL", () => {
    expect(leadParam(`https://app.example/x?lead=${LEAD}`)).toBe(LEAD);
    expect(leadParam("https://app.example/x?lead=1%20or%201=1")).toBeNull();
    expect(leadParam("https://app.example/x")).toBeNull();
  });

  it("starts the call with the business account and returns its SID", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", `AC${"a".repeat(32)}`);
    vi.stubEnv("TWILIO_API_KEY_SID", `SK${"b".repeat(32)}`);
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sid: `CA${"c".repeat(32)}` }), { status: 201 }));
    const sid = await startBridgeCall(
      { staffPhone: "+16095550199", businessNumber: "+16095550100", url: "https://app.example/o", statusCallback: "https://app.example/s" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(sid).toBe(`CA${"c".repeat(32)}`);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"a".repeat(32)}/Calls.json`);
    expect(String(init.body)).toContain("From=%2B16095550100");
  });

  it("passes Twilio's reason on, and refuses without credentials", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", `AC${"a".repeat(32)}`);
    vi.stubEnv("TWILIO_API_KEY_SID", `SK${"b".repeat(32)}`);
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret");
    const refused = vi.fn(async () => new Response(JSON.stringify({ message: "The number is unverified" }), { status: 400 }));
    await expect(startBridgeCall({ staffPhone: "+1", businessNumber: "+1", url: "u", statusCallback: "s" }, refused as unknown as typeof fetch))
      .rejects.toThrow("The number is unverified");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    await expect(startBridgeCall({ staffPhone: "+1", businessNumber: "+1", url: "u", statusCallback: "s" })).rejects.toThrow("Calling isn't set up yet.");
  });
});
