/**
 * Shaping for subcontract jobs: invoice lines and weekly payroll. Pure, so
 * the page, the PDF and the email all say the same thing, and tests can
 * check the arithmetic against what the database froze on the job.
 *
 * The money itself is computed in Postgres (complete_sub_job); nothing here
 * decides an amount, it only lays out what was stored.
 */

import { formatCents } from "@/lib/money";

export function pitchLabel(pitch: number): string {
  return `${pitch}/12`;
}

function quantity(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

export type FrozenJob = {
  squares: number;
  pitch: number;
  baseCents: number;
  pitchCents: number;
};

export type Extra = { description: string; qty: number; unitCents: number };

export type InvoiceLine = { description: string; amountCents: number };

/**
 * One line for the squares (base and pitch together, rounded once, exactly
 * as the database totals it) and one per extra.
 */
export function jobLines(job: FrozenJob, extras: Extra[], what = "Roof labor"): InvoiceLine[] {
  const rate = job.baseCents + job.pitchCents;
  const pitchNote = job.pitchCents > 0
    ? ` (${formatCents(job.baseCents)} + ${formatCents(job.pitchCents)} for ${pitchLabel(job.pitch)} pitch)`
    : ` (${pitchLabel(job.pitch)} pitch)`;
  const lines: InvoiceLine[] = [
    {
      description: `${what}: ${quantity(job.squares)} squares at ${formatCents(rate)}${pitchNote}`,
      amountCents: Math.round(job.squares * rate),
    },
  ];
  for (const extra of extras) {
    lines.push({
      description: `${extra.description}: ${quantity(extra.qty)} at ${formatCents(extra.unitCents)}`,
      amountCents: Math.round(extra.qty * extra.unitCents),
    });
  }
  return lines;
}

export type PayrollRow = {
  workerId: string;
  workerName: string;
  jobId: string;
  workDate: string;
  address: string;
  contractor: string;
  squares: number;
  pitch: number;
  crewSize: number;
  payCents: number;
};

export type WorkerPay = {
  workerId: string;
  name: string;
  totalCents: number;
  jobs: Array<Omit<PayrollRow, "workerId" | "workerName">>;
};

/** The week's done jobs, per worker: what each one is owed and for which jobs. */
export function payrollByWorker(rows: PayrollRow[]): { workers: WorkerPay[]; totalCents: number } {
  const byWorker = new Map<string, WorkerPay>();
  for (const row of rows) {
    const { workerId, workerName, ...job } = row;
    const entry = byWorker.get(workerId) ?? { workerId, name: workerName, totalCents: 0, jobs: [] };
    entry.totalCents += row.payCents;
    entry.jobs.push(job);
    byWorker.set(workerId, entry);
  }
  const workers = [...byWorker.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const w of workers) w.jobs.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.address.localeCompare(b.address));
  return { workers, totalCents: workers.reduce((sum, w) => sum + w.totalCents, 0) };
}
