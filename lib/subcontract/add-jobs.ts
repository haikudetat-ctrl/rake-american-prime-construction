/**
 * Adding subcontract jobs: one in the morning, a week's list from a
 * contractor, or the ones nobody put in (Nov 13). A job typed with its
 * squares is closed as it's added; without them it stays scheduled.
 *
 * Pure, so the form's live totals and the payload it posts come from the same
 * code. The database (add_sub_jobs) is still what decides: it recomputes every
 * closed job and refuses the list if a total differs from the one shown here.
 */

import { closeoutReview, type Rate, type ReviewExtra } from "./review";
import { readTiers } from "./tiers";

/** Whole or decimal squares, like 24 or 24.5, to the hundredth the database keeps. 0 is a gutter-only job. */
export function parseSquares(input: string): number | null {
  if (input.trim() === "") return null;
  const n = Number(input.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
}

/** "12", "12/12" or "12:12" → 12. */
export function parsePitch(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2})(?:\s*[/:]\s*12)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 24 ? n : null;
}

/** How many of a price-list item, like 120 (feet) or 4, to the hundredth. */
export function parseQty(input: string): number | null {
  if (input.trim() === "") return null;
  const n = Number(input.replace(/[,\s]/g, ""));
  const rounded = Math.round(n * 100) / 100;
  return Number.isFinite(n) && rounded > 0 && rounded <= 99999 ? rounded : null;
}

/** The crew's rate, with the database's defaults ($50 a square, $5 a step from 9/12) when none was ever saved. */
export function crewRateFrom(settings: { crew_cents_per_sq: number; crew_pitch_tiers: unknown } | null | undefined): Rate {
  return {
    base: settings?.crew_cents_per_sq ?? 5000,
    tiers: settings ? readTiers(settings.crew_pitch_tiers) : Array.from({ length: 16 }, (_, i) => ({ from: 9 + i, cents: 500 * (i + 1) })),
  };
}

export type PriceItem = { id: string; description: string; unit: string | null; billCents: number; payCents: number };
export type ContractorOption = { id: string; name: string; weekly: boolean; rate: Rate; items: PriceItem[] };

/** One job as typed. Everything is the raw text of its field. `items` is item id → how many. */
export type DraftJob = {
  key: string;
  contractorId: string;
  workDate: string;
  address: string;
  notes: string;
  workerIds: string[];
  squares: string;
  pitch: string;
  items: Record<string, string>;
};

export type DraftCheck =
  | { state: "open" }
  | { state: "close"; squares: number; pitch: number; billCents: number; payCents: number; minimumCents: number; share: number; remainder: number }
  | { state: "invalid"; message: string };

/**
 * The picked items, at the list's prices, in the list's order. An item is
 * picked once it has an entry in `items`, so one ticked with no quantity yet
 * is an error rather than quietly left off the bill.
 */
function pickedItems(job: DraftJob, contractor: ContractorOption | undefined): { item: PriceItem; qty: number }[] | { error: string } {
  const picked: { item: PriceItem; qty: number }[] = [];
  for (const item of contractor?.items ?? []) {
    const text = job.items[item.id];
    if (text === undefined) continue;
    const qty = parseQty(text);
    if (qty === null) return { error: `Enter how many for ${item.description}.` };
    picked.push({ item, qty });
  }
  return picked;
}

/** What adding this job will do: leave it open, close it for these totals, or why it can't go in yet. */
export function checkDraft(job: DraftJob, contractor: ContractorOption | undefined, crewRate: Rate, today: string): DraftCheck {
  const items = pickedItems(job, contractor);
  if ("error" in items) return { state: "invalid", message: items.error };
  if (job.squares.trim() === "") return { state: "open" };
  if (!contractor) return { state: "invalid", message: "Pick the contractor." };
  const squares = parseSquares(job.squares);
  if (squares === null) return { state: "invalid", message: "Squares are a number like 24 or 24.5 (0 for gutters only)." };
  if (squares === 0 && items.length === 0) return { state: "invalid", message: "A 0-square job needs a line item to bill." };
  const pitch = squares === 0 && job.pitch.trim() === "" ? 0 : parsePitch(job.pitch);
  if (pitch === null) return { state: "invalid", message: "Enter the pitch, like 6 or 12/12." };
  if (job.workerIds.length === 0) return { state: "invalid", message: "Pick who worked it to close it." };
  if (job.workDate > today) return { state: "invalid", message: "It's dated after today. Leave the squares blank until it's done." };
  const extras: ReviewExtra[] = items.map(({ item, qty }) => ({
    description: item.description,
    qty,
    bill_unit_cents: item.billCents,
    pay_unit_cents: item.payCents,
    unit: item.unit,
  }));
  const review = closeoutReview(squares, pitch, contractor.rate, crewRate, extras, job.workerIds.length);
  return { state: "close", squares, pitch, ...review };
}

export type JobPayload = {
  contractor_id: string;
  work_date: string;
  address: string;
  notes: string | null;
  worker_ids: string[];
  items: { item_id: string; qty: number }[];
  squares?: number;
  pitch?: number;
  expected_bill_cents?: number;
  expected_pay_cents?: number;
};

/** The list add_sub_jobs takes, or the first job that isn't ready (numbered from 1). */
export function toPayload(
  jobs: DraftJob[],
  contractors: ContractorOption[],
  crewRate: Rate,
  today: string,
): { jobs: JobPayload[] } | { error: string; job: number } {
  const out: JobPayload[] = [];
  for (const [i, job] of jobs.entries()) {
    const contractor = contractors.find((c) => c.id === job.contractorId);
    if (!contractor) return { error: "Pick the contractor.", job: i + 1 };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(job.workDate)) return { error: "Pick the day.", job: i + 1 };
    if (job.address.trim() === "") return { error: "Enter the address.", job: i + 1 };
    const check = checkDraft(job, contractor, crewRate, today);
    if (check.state === "invalid") return { error: check.message, job: i + 1 };
    const items = pickedItems(job, contractor);
    const payload: JobPayload = {
      contractor_id: contractor.id,
      work_date: job.workDate,
      address: job.address.trim(),
      notes: job.notes.trim() || null,
      worker_ids: job.workerIds,
      items: "error" in items ? [] : items.map(({ item, qty }) => ({ item_id: item.id, qty })),
    };
    if (check.state === "close") {
      Object.assign(payload, {
        squares: check.squares,
        pitch: check.pitch,
        expected_bill_cents: check.billCents,
        expected_pay_cents: check.payCents,
      });
    }
    out.push(payload);
  }
  return { jobs: out };
}

/** A pasted list (All Season's week, a text from the crew lead) → one address a line. */
export function splitAddresses(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The most jobs add_sub_jobs takes at once. */
export const MAX_JOBS = 50;
