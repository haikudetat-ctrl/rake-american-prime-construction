import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

/** Renders a page whose sections are async components, waiting for all of them. */
async function renderAll(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  failed: new Set<string>(),
  rpc: {} as Record<string, unknown>,
}));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ role: "office", name: "Office Example" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const respond = (key: string, data: unknown) => {
      const failed = fixture.failed.has(key);
      const result = { data: failed ? null : data, count: Array.isArray(data) ? data.length : null, error: failed ? { code: "PGRST205", message: "Missing relation" } : null };
      const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      for (const method of ["select", "eq", "neq", "in", "is", "or", "gte", "lt", "lte", "order", "limit"]) chain[method] = () => chain;
      chain.maybeSingle = () => respond(key, Array.isArray(data) ? (data[0] ?? null) : data);
      chain.single = () => respond(key, Array.isArray(data) ? (data[0] ?? null) : data);
      return chain;
    };
    return {
      from: (table: string) => respond(table, fixture.rows[table] ?? []),
      rpc: (name: string) => respond(name, fixture.rpc[name] ?? null),
    };
  },
}));
import BillingPage from "@/app/office/billing/page";
import CustomersPage from "@/app/office/customers/page";
import InboxPage from "@/app/office/inbox/page";
import ThreadPage from "@/app/office/inbox/[phone]/page";
import NumbersPage from "@/app/office/numbers/page";
import { billingExceptions } from "@/lib/office/today";
import { searchTerm } from "@/lib/office/search";

// Synthetic records only. "Today" is Wednesday 2026-11-25 in the company's time zone.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T16:00:00Z"));
  fixture.rows = {};
  fixture.failed.clear();
  fixture.rpc = {};
});
afterEach(() => vi.useRealTimers());
const props = (searchParams: Record<string, string> = {}, params: Record<string, string> = {}) => ({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
const ok = <T,>(data: T[]) => ({ data, count: data.length, error: null });

describe("billing to fix on Today", () => {
  const customer = { name: "Example Builders", billing_email: "billing@example.test" };
  it("lists stuck tickets, unsent statements and past-due statements oldest first, with no dollar total", () => {
    const q = billingExceptions("2026-11-25", {
      tickets: ok([
        { id: "r-1", picked_up_at: "2026-11-20T15:00:00Z", sites: { address: "1 Example Road" }, customers: { name: "Example Builders" } },
        // Picked up today: the ticket usually goes in the same day, so it isn't stuck yet.
        { id: "r-2", picked_up_at: "2026-11-25T14:00:00Z", sites: { address: "2 Example Lane" }, customers: { name: "Example Builders" } },
      ]),
      unsent: ok([
        { id: "s-1", number: 41, issued_on: "2026-11-23", due_on: "2026-12-08", total_cents: 50000, sent_at: null, customers: { name: "No Email Co", billing_email: null } },
        // Past due and never emailed: listed once, as past due.
        { id: "s-2", number: 30, issued_on: "2026-11-02", due_on: "2026-11-17", total_cents: 90000, sent_at: null, customers: customer },
      ]),
      pastDue: ok([
        { id: "s-2", number: 30, issued_on: "2026-11-02", due_on: "2026-11-17", total_cents: 90000, sent_at: null, customers: customer, payments: [{ amount_cents: 20000 }] },
      ]),
    });
    expect(q.count).toBe(3);
    expect(q.items.map((i) => i.href)).toEqual(["/office/billing/s-2", "/office/rentals/r-1", "/office/billing/s-1"]);
    expect(q.items[0].detail).toBe("$700.00 was due Tue, Nov 17 · 8 days past due · never emailed");
    expect(q.items[1].detail).toContain("can't bill until the scale ticket is in");
    expect(q.items[2].detail).toContain("no billing email, send it yourself");
    expect(q.label).toBe("Billing to fix");
  });

  it("reads as unavailable, not empty, when any part fails to load", () => {
    const q = billingExceptions("2026-11-25", { tickets: ok([]), unsent: { data: null, error: { message: "down" } }, pastDue: ok([]) });
    expect(q.count).toBeNull();
  });
});

describe("dumpster billing", () => {
  it("groups ready invoices by customer and flags cans back without a ticket", async () => {
    fixture.rows = {
      invoices: [
        { id: "i-1", number: 104, status: "final", total_cents: 55000, rental_id: "r-1", customer_id: "c-1", customers: { name: "Example Builders", billing_email: "billing@example.test" }, rentals: { status: "closed", sites: { address: "1 Example Road" } } },
        { id: "i-2", number: 105, status: "final", total_cents: 48000, rental_id: "r-2", customer_id: "c-1", customers: { name: "Example Builders", billing_email: "billing@example.test" }, rentals: { status: "closed", sites: { address: "2 Example Lane" } } },
        { id: "i-3", number: 106, status: "draft", total_cents: 35000, rental_id: "r-3", customer_id: "c-2", customers: { name: "No Email Co", billing_email: null }, rentals: { status: "picked_up", sites: { address: "3 Example Court" } } },
      ],
      statements: [
        { id: "s-1", number: 30, issued_on: "2026-11-02", due_on: "2026-11-17", total_cents: 90000, status: "open", sent_at: "2026-11-02T13:00:00Z", customers: { name: "Example Builders", billing_email: "billing@example.test" }, payments: [] },
      ],
    };
    const html = renderToStaticMarkup(await BillingPage(props()));
    expect(html).toContain("Ready for billing");
    expect(html).toContain("2 completed rentals ready · $1,030.00");
    expect(html).toContain("Needs ticket");
    expect(html).toContain("1 can is back and waiting on a ticket.");
    expect(html).toContain("Overdue");
    expect(html).toContain("balance $900.00 · emailed");
  });

  it("shows a failed load as unavailable rather than nothing to bill", async () => {
    fixture.failed.add("invoices");
    const html = renderToStaticMarkup(await BillingPage(props()));
    expect(html).toContain("Ready for billing is unavailable");
    expect(html).not.toContain("Nothing waiting to be billed");
  });
});

describe("customers", () => {
  it("marks customers who can't be emailed a statement", async () => {
    fixture.rows = {
      customers: [
        { id: "c-1", name: "Example Builders", phone: "+16095550100", billing_email: "billing@example.test", payment_terms_days: 15, sites: [{ count: 3 }] },
        { id: "c-2", name: "No Email Co", phone: null, billing_email: null, payment_terms_days: 30, sites: [{ count: 1 }] },
      ],
    };
    const html = renderToStaticMarkup(await CustomersPage(props()));
    expect(html).toContain("2 active · 1 without a billing email");
    expect(html).toContain("3 job addresses · billing@example.test · 15-day terms");
    expect(html).toContain("No email");
  });

  it("keeps a search to plain words so it can't alter the filter", () => {
    expect(searchTerm("Smith,phone.eq.1)")).toBe("Smith phone eq 1");
    expect(searchTerm(["array"])).toBe("");
  });
});

describe("inbox", () => {
  it("shows the inbox as unavailable when texts fail to load, not as empty", async () => {
    fixture.failed.add("messages");
    const html = await renderAll(await InboxPage(props()));
    expect(html).toContain("Texts is unavailable");
    expect(html).not.toContain("No texts yet");
  });

  it("pauses texting when the number opted out, and when the opt-out check fails", async () => {
    fixture.rows = { sms_opt_outs: [{ opted_out_at: "2026-11-25T14:22:00Z" }] };
    const stopped = renderToStaticMarkup(await ThreadPage({ params: Promise.resolve({ phone: "+16095550142" }), searchParams: Promise.resolve({}) }));
    expect(stopped).toContain("Texting is paused");
    expect(stopped).toContain("No text can be sent from this conversation.");
    expect(stopped).not.toContain('name="body"');

    fixture.rows = {};
    fixture.failed.add("sms_opt_outs");
    const unknown = renderToStaticMarkup(await ThreadPage({ params: Promise.resolve({ phone: "+16095550142" }), searchParams: Promise.resolve({}) }));
    expect(unknown).toContain("couldn&#x27;t check whether this number opted out");
    expect(unknown).not.toContain('name="body"');
  });
});

describe("numbers", () => {
  it("says a section is unavailable instead of hiding it", async () => {
    fixture.rpc = {
      weekly_numbers: { rentals_dropped: 4, rentals_picked_up: 3, avg_days_out: 5, avg_days_pickup_to_invoice: 1, cans_in_service: 10, cans_out: 6, unbilled_cents: 0, open_balance_cents: 0, overdue_cents: 0 },
    };
    fixture.failed.add("lead_numbers");
    const html = await renderAll(await NumbersPage(props()));
    expect(html).toContain("This week’s numbers");
    expect(html).toContain("Roofing numbers is unavailable");
  });
});
