import { beforeEach, describe, expect, it, vi } from "vitest";
import { twilioSignature } from "@/lib/phone/twiml";

// Webhook-level checks for forwarding a call to the ring list: the staff phone
// sees the business number, and the screen tells them who is calling.

type Rows = Record<string, Array<Record<string, unknown>>>;
const db = { rows: {} as Rows, rpcs: [] as Array<{ fn: string; args: unknown }> };

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let desc = false;
  const run = () => {
    let out = (db.rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    if (desc) out = [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return out;
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push([k, v]), q),
    order: (_k: string, o?: { ascending?: boolean }) => ((desc = o?.ascending === false), q),
    limit: () => q,
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: query,
    rpc: async (fn: string, args: unknown) => (db.rpcs.push({ fn, args }), { data: null, error: null }),
  }),
}));

const APP = "https://rake.example";
const BUSINESS = "+16094512060";
const CALLER = "+16095550100";
const PARENT = "CA" + "a".repeat(32);
const CHILD = "CA" + "b".repeat(32);

function twilioPost(path: string, params: Record<string, string>) {
  const signature = twilioSignature("test-token", `${APP}${path}`, params);
  return new Request(`${APP}${path}`, {
    method: "POST",
    headers: { "x-twilio-signature": signature },
    body: new URLSearchParams(params),
  });
}

beforeEach(() => {
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("APP_URL", APP);
  db.rpcs = [];
  db.rows = {
    phone_settings: [{
      company_id: "co1", business_number: BUSINESS, ring_numbers: ["+16098260410"], ring_seconds: 20,
      open_days: [1, 2, 3, 4, 5, 6, 7], open_time: "00:00", close_time: "23:59",
      greeting: "Hi", after_hours_greeting: "Closed", notify_texts: true,
    }],
    brands: [{ kind: "roofing", display_name: "Authority Roofing" }],
    phone_calls: [{ call_sid: PARENT, company_id: "co1", from_number: CALLER }],
    leads: [],
    customers: [],
  };
});

describe("forwarding a business call", () => {
  it("rings staff from the business number and keeps the caller on the call record", async () => {
    const { POST } = await import("@/app/api/twilio/voice/route");
    const res = await POST(twilioPost("/api/twilio/voice", { CallSid: PARENT, From: CALLER, To: BUSINESS }));
    const xml = await res.text();
    expect(xml).toContain(`callerId="${BUSINESS}"`);
    expect(xml).not.toContain(`callerId="${CALLER}"`);
    expect(xml).toContain(`<Number url="${APP}/api/twilio/voice/screen?call=${PARENT}" method="POST">+16098260410</Number>`);
    expect(xml).toContain(`action="${APP}/api/twilio/voice/dial-done"`);
    expect(db.rpcs[0]).toEqual({
      fn: "record_inbound_call",
      args: { p_call_sid: PARENT, p_from: CALLER, p_to: BUSINESS, p_after_hours: false },
    });
  });
});

describe("the screen", () => {
  const screen = async (path = `/api/twilio/voice/screen?call=${PARENT}`, extra: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/twilio/voice/screen/route");
    const res = await POST(twilioPost(path, { CallSid: CHILD, From: BUSINESS, To: "+16098260410", ...extra }));
    return res.text();
  };

  it("names an open lead first", async () => {
    db.rows.leads = [
      { company_id: "co1", phone: CALLER, name: "Old Won Job", stage: "won", created_at: "2026-11-20" },
      { company_id: "co1", phone: CALLER, name: "Maria Lopez", stage: "new", created_at: "2026-11-01" },
    ];
    expect(await screen()).toContain("<Say>Call for Authority Roofing from Maria Lopez. Press 1 to answer.</Say>");
  });

  it("escapes a lead name in the whisper", async () => {
    db.rows.leads = [{ company_id: "co1", phone: CALLER, name: "Jo & <Sam>", stage: "new", created_at: "2026-11-01" }];
    expect(await screen()).toContain("from Jo &amp; &lt;Sam&gt;.");
  });

  it("falls back to a dumpster customer, then the number", async () => {
    db.rows.customers = [{ company_id: "co1", phone: CALLER, name: "Shore Builders", is_active: true, created_at: "2026-10-01" }];
    expect(await screen()).toContain("from Shore Builders.");
    db.rows.customers = [];
    expect(await screen()).toContain("from 6 0 9, 5 5 5, 0 1 0 0.");
  });

  it("reads the number when the lead only has Rake's placeholder name", async () => {
    db.rows.leads = [{ company_id: "co1", phone: CALLER, name: `New caller ${CALLER}`, stage: "new", created_at: "2026-11-01" }];
    expect(await screen()).toContain("from 6 0 9, 5 5 5, 0 1 0 0.");
  });

  it("uses ParentCallSid when the URL has no call", async () => {
    expect(await screen("/api/twilio/voice/screen", { ParentCallSid: PARENT })).toContain("from 6 0 9, 5 5 5, 0 1 0 0.");
  });

  it("still screens when the call can't be found", async () => {
    db.rows.phone_calls = [];
    const xml = await screen();
    expect(xml).toContain("<Say>Call for Authority Roofing. Press 1 to answer.</Say>");
    expect(xml).toContain(`action="${APP}/api/twilio/voice/screen-done"`);
  });

  it("rejects an unsigned request", async () => {
    const { POST } = await import("@/app/api/twilio/voice/screen/route");
    const res = await POST(new Request(`${APP}/api/twilio/voice/screen?call=${PARENT}`, { method: "POST", body: new URLSearchParams({}) }));
    expect(res.status).toBe(403);
  });
});
