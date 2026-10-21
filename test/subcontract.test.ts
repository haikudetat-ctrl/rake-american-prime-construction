import { describe, expect, it } from "vitest";
import { jobLines, payrollByWorker, pitchLabel, type PayrollRow } from "@/lib/subcontract/view";

describe("subcontract invoice lines", () => {
  it("bills the squares at base plus pitch, then each extra", () => {
    // The pgTAP suite's job: 25 sq at 12/12 for All Season ($95 + $20), 3 sheets of plywood at $45.
    const lines = jobLines({ squares: 25, pitch: 12, baseCents: 9500, pitchCents: 2000 }, [
      { description: "Plywood sheet", qty: 3, unitCents: 4500 },
    ]);
    expect(lines.map((l) => l.amountCents)).toEqual([287500, 13500]);
    expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(301000);
    expect(lines[0].description).toBe("Roof labor: 25 squares at $115.00 ($95.00 + $20.00 for 12/12 pitch)");
  });

  it("rounds a fractional square once, the way the database does", () => {
    const [line] = jobLines({ squares: 25.33, pitch: 10, baseCents: 9500, pitchCents: 1000 }, []);
    expect(line.amountCents).toBe(Math.round(25.33 * 10500));
    expect(line.description).toContain("25.33 squares");
  });

  it("leaves the pitch extra out when there is none", () => {
    const [line] = jobLines({ squares: 20, pitch: 6, baseCents: 11000, pitchCents: 0 }, []);
    expect(line.description).toBe("Roof labor: 20 squares at $110.00 (6/12 pitch)");
    expect(pitchLabel(8)).toBe("8/12");
  });
});

describe("weekly payroll", () => {
  const row = (worker: string, job: string, date: string, pay: number): PayrollRow => ({
    workerId: worker.toLowerCase(),
    workerName: worker,
    jobId: job,
    workDate: date,
    address: `${job} St`,
    contractor: "All Season",
    squares: 20,
    pitch: 6,
    crewSize: 2,
    payCents: pay,
  });

  it("totals each guy across the jobs he worked, names in order", () => {
    const { workers, totalCents } = payrollByWorker([
      row("Walter", "j2", "2026-10-20", 50000),
      row("Baltimore", "j2", "2026-10-20", 50000),
      row("Baltimore", "j1", "2026-10-19", 59834),
    ]);
    expect(workers.map((w) => w.name)).toEqual(["Baltimore", "Walter"]);
    expect(workers[0].totalCents).toBe(109834);
    expect(workers[0].jobs.map((j) => j.jobId)).toEqual(["j1", "j2"]);
    expect(totalCents).toBe(159834);
  });

  it("is empty for a week with no closed jobs", () => {
    expect(payrollByWorker([])).toEqual({ workers: [], totalCents: 0 });
  });
});

describe("contractor invoice email", () => {
  it("names the job, the amount due and the due date", async () => {
    const { subInvoiceEmail } = await import("@/lib/outbox/messages");
    const email = subInvoiceEmail({
      id: "i1", number: 1043, issuedOn: "2026-10-21", dueOn: "2026-11-04", status: "open", voidReason: null, sentAt: null,
      totalCents: 301000, paidCents: 0, balanceCents: 301000,
      brand: { name: "American Prime Construction", phone: "+16095550100", email: null, address: null },
      contractor: { name: "All Season", billingEmail: "ap@allseason.example" },
      job: { id: "j1", address: "232 Hewitt St, Trenton", workDate: "2026-10-21", squares: 25, pitch: 12 },
      lines: [{ description: "Roof labor: 25 squares at $115.00", amountCents: 287500 }, { description: "Plywood sheet: 3 at $45.00", amountCents: 13500 }],
      payments: [],
    });
    expect(email.subject).toBe("Invoice #1043 from American Prime Construction: 232 Hewitt St, Trenton, $3,010.00 due Wed, Nov 4");
    expect(email.text).toContain("Plywood sheet: 3 at $45.00  $135.00");
    expect(email.text).toContain("Total due: $3,010.00 by Wed, Nov 4.");
  });
});
