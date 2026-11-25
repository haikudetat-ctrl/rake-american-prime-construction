import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  counts: {} as Record<string, number>,
  failed: new Set<string>(),
}));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ role: "office", name: "Office Example" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const failed = fixture.failed.has(table);
      const data = fixture.rows[table] ?? [];
      const result = { data: failed ? null : data, count: failed ? null : (fixture.counts[table] ?? data.length), error: failed ? { code: "PGRST205", message: "Missing relation" } : null };
      const chain: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      for (const method of ["select", "eq", "neq", "in", "gte", "lt", "lte", "order", "limit", "maybeSingle"]) chain[method] = () => chain;
      return chain;
    },
  }),
}));
import SubsPage from "@/app/office/subs/page";
import PayrollPage from "@/app/office/subs/payroll/page";
import InvoicesPage from "@/app/office/subs/invoices/page";

// Synthetic records only. "Today" is Wednesday 2026-11-25 in the company's time zone.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T16:00:00Z"));
  fixture.rows = {};
  fixture.counts = {};
  fixture.failed.clear();
});
afterEach(() => vi.useRealTimers());
const props = (searchParams: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });

describe("weekly subcontract work", () => {
  it("lists the week's jobs as work rows with the next step, and the week's money in the side panel", async () => {
    fixture.rows = {
      sub_contractors: [{ id: "gc-1", name: "Example Roofing Co", billing: "per_job", cents_per_sq: 9500, pitch_tiers: [], min_job_cents: null }],
      sub_workers: [{ id: "w-1", name: "Avery Example" }],
      sub_jobs: [
        { id: "j-1", work_date: "2026-11-24", address: "1 Example Road", status: "scheduled", squares: null, pitch: null, bill_total_cents: null, pay_total_cents: null, sub_contractors: { name: "Example Roofing Co" }, sub_job_crew: [], sub_invoices: [] },
        { id: "j-2", work_date: "2026-11-23", address: "2 Example Lane", status: "done", squares: 20, pitch: 6, bill_total_cents: 190000, pay_total_cents: 100000, sub_contractors: { name: "Example Roofing Co" }, sub_job_crew: [{ sub_workers: { name: "Avery Example" } }], sub_invoices: [{ number: 7, status: "open" }] },
      ],
      sub_invoices: [{ total_cents: 190000, sub_payments: [{ amount_cents: 40000, voided_at: null }] }],
    };
    const html = renderToStaticMarkup(await SubsPage(props()));
    expect(html).toContain("Weekly subcontract work");
    expect(html).toContain("1 scheduled · 1 finished");
    expect(html).toContain("1 job is still open from today or earlier");
    expect(html).toContain("Assign crew");
    expect(html).toContain("20 sq at 6/12 · billed $1,900.00 · crew $1,000.00 · invoice #7 outstanding");
    expect(html).toContain("This week so far");
    expect(html).toContain("$900.00 (47%)");
    expect(html).toContain("$1,500.00");
    expect(html).toContain('href="#add-jobs"');
  });

  it("says when the week is empty instead of showing a blank list", async () => {
    fixture.rows = { sub_contractors: [], sub_workers: [] };
    const html = renderToStaticMarkup(await SubsPage(props()));
    expect(html).toContain("No jobs this week");
    expect(html).not.toContain('href="#add-jobs"');
  });
});

describe("weekly crew earnings", () => {
  it("totals each person's shares, says what the page does not do, and flags unfinished jobs", async () => {
    fixture.rows = {
      sub_job_crew: [
        { worker_id: "w-1", pay_cents: 50000, sub_workers: { name: "Avery Example" }, sub_jobs: { id: "j-2", work_date: "2026-11-23", address: "2 Example Lane", squares: 20, pitch: 6, status: "done", sub_contractors: { name: "Example Roofing Co" }, sub_job_crew: [{ worker_id: "w-1" }, { worker_id: "w-2" }] } },
        { worker_id: "w-2", pay_cents: 50000, sub_workers: { name: "Blake Example" }, sub_jobs: { id: "j-2", work_date: "2026-11-23", address: "2 Example Lane", squares: 20, pitch: 6, status: "done", sub_contractors: { name: "Example Roofing Co" }, sub_job_crew: [{ worker_id: "w-1" }, { worker_id: "w-2" }] } },
      ],
    };
    fixture.counts = { sub_jobs: 1 };
    const html = renderToStaticMarkup(await PayrollPage(props()));
    expect(html).toContain("Weekly crew earnings");
    expect(html).toContain("$1,000.00 earned");
    expect(html).toContain("2 people · 1 finished job");
    expect(html).toContain("1 job this week isn&#x27;t finished, so it&#x27;s not included");
    expect(html).toContain("doesn&#x27;t pay anyone");
    expect(html).toContain("split 2 ways");
  });

  it("shows an empty week as empty and a failed read as unavailable, never as zero", async () => {
    const empty = renderToStaticMarkup(await PayrollPage(props()));
    expect(empty).toContain("No finished jobs this week");
    fixture.failed.add("sub_job_crew");
    const failed = renderToStaticMarkup(await PayrollPage(props()));
    expect(failed).toContain("Weekly crew earnings is unavailable");
    expect(failed).not.toContain("$0.00");
  });
});

describe("contractor invoices", () => {
  it("marks overdue and paid invoices and never calls a weekly contractor's invoice emailed", async () => {
    fixture.rows = {
      sub_invoices: [
        { id: "i-1", job_id: "j-1", number: 7, due_on: "2026-11-20", status: "open", total_cents: 190000, sent_at: "2026-11-10T15:00:00Z", sub_contractors: { name: "Example Roofing Co", billing: "per_job" }, sub_jobs: { address: "1 Example Road" }, sub_payments: [{ amount_cents: 40000, voided_at: null }] },
        { id: "i-2", job_id: "j-2", number: 8, due_on: "2026-12-05", status: "open", total_cents: 100000, sent_at: null, sub_contractors: { name: "Weekly Example GC", billing: "weekly" }, sub_jobs: { address: "2 Example Lane" }, sub_payments: [] },
      ],
    };
    const html = renderToStaticMarkup(await InvoicesPage(props()));
    expect(html).toContain("2 invoices · $2,500.00 still owed.");
    expect(html).toContain("Overdue");
    expect(html).toContain("balance $1,500.00 · due Fri, Nov 20 · emailed");
    expect(html).toContain("on the weekly statement");
    expect(html).not.toContain("not emailed yet");
  });
});
