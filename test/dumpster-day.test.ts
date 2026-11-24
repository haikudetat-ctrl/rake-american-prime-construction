import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  failed: new Set<string>(),
  run: [] as unknown[],
  member: { userId: "u-alex", companyId: "co-1", role: "driver", name: "Alex Example", locale: "en" } as Record<string, unknown>,
  businessNumber: null as string | null,
}));
vi.mock("@/lib/auth", () => ({
  requireStaff: async () => ({ role: "office", name: "Office Example" }),
  requireDriver: async () => fixture.member,
  isStaff: (role: string) => role === "owner" || role === "office",
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ push: vi.fn() }) }));
// Static image imports have no size under vitest; the brand bar isn't what these tests check.
vi.mock("@/app/_components/brand", () => ({ BrandBar: () => null }));
vi.mock("@/lib/phone/server",() => ({ loadPhoneSettings: async () => ({ businessNumber: fixture.businessNumber }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async () => ({ data: fixture.run, error: null }),
    from: (table: string) => {
      const failed = fixture.failed.has(table);
      const result = { data: failed ? null : (fixture.rows[table] ?? []), error: failed ? { code: "PGRST205", message: "Missing relation" } : null };
      const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      for (const method of ["select", "eq", "neq", "in", "order", "limit", "maybeSingle"]) chain[method] = () => chain;
      return chain;
    },
  }),
}));
import DispatchPage from "@/app/office/dumpsters/page";
import DriverPage from "@/app/driver/page";
import CansPage from "@/app/office/cans/page";
import RequestsPage from "@/app/office/requests/page";

// Synthetic records only. "Today" is pinned to 2026-11-24 in the company's time zone.
const rental = (id: string, address: string, over: Record<string, unknown> = {}) => ({
  id, size_yards: 20, notes: null, customers: { name: "Example Builders" }, sites: { address, area: "Ventnor", notes: null }, cans: null, ...over,
});
const TEAM = {
  memberships: [{ user_id: "u-alex", role: "driver", is_active: true }],
  profiles: [{ user_id: "u-alex", full_name: "Alex Example", phone: null }],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
  fixture.rows = {};
  fixture.failed.clear();
  fixture.run = [];
  fixture.member = { userId: "u-alex", companyId: "co-1", role: "driver", name: "Alex Example", locale: "en" };
  fixture.businessNumber = null;
});
afterEach(() => vi.useRealTimers());
const props = (searchParams: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });

describe("dispatch board", () => {
  it("shows each run in order, the stops that need a driver, and the yard", async () => {
    fixture.rows = {
      ...TEAM,
      stops: [
        { id: "s1", kind: "drop", status: "scheduled", sequence: 1, driver_id: "u-alex", rentals: rental("r1", "1 Example Road", { sites: { address: "1 Example Road", area: null, notes: "Left driveway" } }) },
        { id: "s2", kind: "pickup", status: "done", sequence: 2, driver_id: "u-alex", rentals: rental("r2", "2 Example Lane", { cans: { label: "C-08" } }) },
        { id: "s3", kind: "drop", status: "scheduled", sequence: 0, driver_id: null, rentals: rental("r3", "3 Example Court") },
      ],
      cans: [
        { id: "c1", label: "C-12", size_yards: 20, status: "available" },
        { id: "c2", label: "C-15", size_yards: 20, status: "out_of_service" },
      ],
    };
    const html = renderToStaticMarkup(await DispatchPage(props()));
    expect(html).toContain("Today’s dispatch");
    expect(html).toContain("3 stops · 1 done · 1 needs a driver");
    expect(html).toContain("Alex Example’s run");
    expect(html).toContain("1 stop needs a driver");
    expect(html).toContain("Left driveway");
    expect(html).toContain("No placement note yet");
    expect(html).toContain("C-12 · 20-yard");
    expect(html).toContain("1 out of service");
    // Two open 20-yard drops, one 20-yard can in the yard.
    expect(html).toContain("2 open 20-yard drops");
    expect(html).toContain("/office/rentals/r1");
  });

  it("says the stops are unavailable rather than showing an empty day", async () => {
    fixture.rows = TEAM;
    fixture.failed.add("stops");
    const html = renderToStaticMarkup(await DispatchPage(props()));
    expect(html).toContain("Dispatch is unavailable");
    expect(html).toContain("the count is unknown");
    expect(html).not.toContain("No stops scheduled");
  });

  it("says plainly when nothing is scheduled", async () => {
    fixture.rows = TEAM;
    const html = renderToStaticMarkup(await DispatchPage(props({ date: "2026-11-25" })));
    expect(html).toContain("No stops scheduled");
    expect(html).not.toContain("Today’s dispatch");
  });
});

const runStop = (id: string, kind: string, status: string, address: string, over: Record<string, unknown> = {}) => ({
  stop_id: id, kind, status, address, area: null, site_notes: null, rental_notes: null, customer_name: "Example Builders",
  contact_name: "Sam", contact_phone: "+16095550100", can_label: null, size_yards: 20, ...over,
});

describe("driver next stop", () => {
  it("leads with the first stop not done and keeps the rest below", async () => {
    fixture.run = [
      runStop("1", "drop", "done", "1 Example Road"),
      runStop("2", "pickup", "scheduled", "2 Example Lane", { can_label: "C-08", site_notes: "Behind the garage" }),
      runStop("3", "dump", "scheduled", "Yard"),
    ];
    const html = renderToStaticMarkup(await DriverPage(props()));
    expect(html).toContain("Your next stop");
    expect(html).toContain("Pick up · 2 Example Lane");
    expect(html).toContain("Can C-08 · 20 yd · stop 2 of 3");
    expect(html).toContain("Behind the garage");
    expect(html).toContain("Take a photo of the load before you lift it.");
    expect(html).toContain("Next on run");
    expect(html).toContain("Dump · Landfill");
    expect(html).toContain("Done today");
    // No business line yet, so no office button.
    expect(html).not.toContain("Call office");
  });

  it("speaks Spanish and shows the office button once a business line exists", async () => {
    fixture.member = { ...fixture.member, locale: "es" };
    fixture.businessNumber = "+16095550199";
    fixture.run = [runStop("1", "drop", "scheduled", "1 Example Road")];
    const html = renderToStaticMarkup(await DriverPage(props()));
    expect(html).toContain("Tu próxima parada");
    expect(html).toContain("Estaciónate en un lugar seguro");
    expect(html).toContain("No hay nota de ubicación");
    expect(html).toContain("Esta es la última parada de hoy.");
    expect(html).toContain('href="tel:+16095550199"');
  });

  it("says the day is finished when every stop is done", async () => {
    fixture.run = [runStop("1", "drop", "done", "1 Example Road")];
    const html = renderToStaticMarkup(await DriverPage(props()));
    expect(html).toContain("Every stop is done for today.");
    expect(html).not.toContain("Your next stop");
  });
});

describe("cans and requests", () => {
  it("never shows a failed read as an empty yard", async () => {
    fixture.rows = TEAM;
    fixture.failed.add("rentals_out");
    fixture.failed.add("cans");
    const html = renderToStaticMarkup(await CansPage(props()));
    expect(html).toContain("Cans out is unavailable");
    expect(html).toContain("the counts are unknown");
    expect(html).not.toContain("Every can is in the yard");
  });

  it("shows how long each can has been out and flags extended rentals", async () => {
    fixture.rows = {
      ...TEAM,
      rentals_out: [{ rental_id: "r1", can_label: "C-08", size_yards: 20, customer_name: "Example Builders", address: "2 Example Lane", area: null, days_out: 12, is_extended: true, extended_after_days: 7, status: "on_site" }],
      cans: [{ id: "c1", label: "C-08", size_yards: 20, status: "on_site", yards: { name: "Main yard" } }],
    };
    const html = renderToStaticMarkup(await CansPage(props()));
    expect(html).toContain("0 of 1 in the yard · 1 out on rentals · 1 past the included days.");
    expect(html).toContain("Out 12 days · past 7 days, extended charge applies");
    expect(html).toContain("Schedule pickup");
  });

  it("marks a request from someone new and keeps declining behind a step", async () => {
    fixture.rows = {
      ...TEAM,
      rental_requests: [{ id: "q1", contact_name: "Sam Example", company_name: null, phone: "+16095550100", email: null, address: "3 Example Court", lat: null, requested_date: "2026-11-26", size_yards: 20, notes: null }],
      customers: [],
    };
    const html = renderToStaticMarkup(await RequestsPage(props()));
    expect(html).toContain("1 request waiting, soonest first.");
    expect(html).toContain("New customer");
    expect(html).toContain("Not found on the map");
    expect(html).toContain("Decline this request");
  });
});
