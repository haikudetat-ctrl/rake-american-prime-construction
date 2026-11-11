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
  /** The top-up to the contractor's minimum job charge, frozen at close. */
  minimumCents?: number;
};

/** `unit` is what a price-list extra is counted in; null for one typed by hand. */
export type Extra = { description: string; qty: number; unitCents: number; unit?: string | null };

/** "120 ft", "24.5 sq"; plain counts (each, sheets) stay bare. */
function counted(qty: number, unit: string | null | undefined): string {
  return unit === "ft" || unit === "sq" ? `${quantity(qty)} ${unit}` : quantity(qty);
}

export type InvoiceLine = { description: string; amountCents: number };

/**
 * One line for the squares (base and pitch together, rounded once, exactly
 * as the database totals it), one per extra, and the minimum top-up last.
 * A gutter-only job has no squares, so no squares line.
 */
export function jobLines(job: FrozenJob, extras: Extra[], what = "Roof labor"): InvoiceLine[] {
  const rate = job.baseCents + job.pitchCents;
  const pitchNote = job.pitchCents > 0
    ? ` (${formatCents(job.baseCents)} + ${formatCents(job.pitchCents)} for ${pitchLabel(job.pitch)} pitch)`
    : ` (${pitchLabel(job.pitch)} pitch)`;
  const lines: InvoiceLine[] = [];
  if (job.squares > 0) {
    lines.push({
      description: `${what}: ${quantity(job.squares)} squares at ${formatCents(rate)}${pitchNote}`,
      amountCents: Math.round(job.squares * rate),
    });
  }
  for (const extra of extras) {
    lines.push({
      description: `${extra.description}: ${counted(extra.qty, extra.unit)} at ${formatCents(extra.unitCents)}`,
      amountCents: Math.round(extra.qty * extra.unitCents),
    });
  }
  if (job.minimumCents && job.minimumCents > 0) {
    const subtotal = lines.reduce((sum, l) => sum + l.amountCents, 0);
    lines.push({
      description: `Minimum job charge: brings this job to ${formatCents(subtotal + job.minimumCents)}`,
      amountCents: job.minimumCents,
    });
  }
  return lines;
}

/** "24 squares · 12/12 pitch", or "Gutters and extras" for a job with no squares. */
export function jobScope(squares: number, pitch: number): string {
  return squares > 0 ? `${quantity(squares)} squares · ${pitchLabel(pitch)} pitch` : "Gutters and extras";
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
