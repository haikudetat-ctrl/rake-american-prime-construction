/**
 * Adding dumpster rentals: a booking, a contractor's list of jobs, or a rental
 * nobody recorded (Nov 13). Each one is in one of three states:
 *   scheduled  booked for today or later; goes on the run;
 *   on_site    dropped and still out: the can leaves the yard, the invoice
 *              opens with the delivery;
 *   done       dropped, picked up and dumped: billed in full and final.
 *
 * Pure, so the form's totals and the list it posts come from the same code.
 * The database (add_rentals) recomputes every invoice and refuses the list if
 * a total differs from the one shown here.
 */

import { parseDollarsToCents } from "@/lib/money";

export type RentalState = "scheduled" | "on_site" | "done";
export const STATE_LABEL: Record<RentalState, string> = {
  scheduled: "Booked",
  on_site: "Out on the job",
  done: "Picked up and dumped",
};

export type PriceBook = { id: string; version: number; createdOn: string; deliveryCents: number; afterDays: number; perDayCents: number };
export type ChargeItem = { id: string; description: string; unit: string; unitCents: number };
export type CustomerOption = { id: string; name: string; sites: { id: string; address: string }[] };
export type CanOption = { id: string; label: string; sizeYards: number; inYard: boolean };

/** Everything the form knows about the company. */
export type RentalContext = {
  customers: CustomerOption[];
  books: PriceBook[];
  items: ChargeItem[];
  cans: CanOption[];
  today: string;
};

/** One rental as typed. `siteId` is one of the customer's sites, or "new" with `address`. `items` is item id → how many. */
export type DraftRental = {
  key: string;
  customerId: string;
  siteId: string;
  address: string;
  state: RentalState;
  dropDate: string;
  canId: string;
  pickedUpOn: string;
  tons: string;
  dumpFee: string;
  ticket: string;
  landfillId: string;
  notes: string;
  items: Record<string, string>;
};

/** How many of a price-list item, like 2 or 1.5, to the hundredth the database keeps. */
export function parseQty(input: string): number | null {
  if (input.trim() === "") return null;
  const n = Number(input.replace(/[,\s]/g, ""));
  const rounded = Math.round(n * 100) / 100;
  return Number.isFinite(n) && rounded > 0 && rounded <= 9999 ? rounded : null;
}

/** Tons off a scale ticket, like 2.37. */
export function parseTons(input: string): number | null {
  if (input.trim() === "") return null;
  const n = Number(input.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 99 ? Math.round(n * 100) / 100 : null;
}

/** qty × price in cents, rounded the way Postgres rounds round(numeric × int): half a cent up, never down from float error. */
export function lineCents(qty: number, unitCents: number): number {
  return Math.round((Math.round(qty * 100) * unitCents) / 100);
}

/** Calendar days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** The price book in force on a day: the newest published on or before it, else the first. Mirrors app.price_book_on. */
export function bookOn(books: PriceBook[], day: string): PriceBook | null {
  const sorted = [...books].sort((a, b) => a.version - b.version);
  return [...sorted].reverse().find((b) => b.createdOn <= day) ?? sorted[0] ?? null;
}

/** A pasted list (a contractor's jobs for the week) → one address a line. */
export function splitAddresses(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export type BillLine = { label: string; cents: number };
export type RentalCheck =
  | { state: "scheduled" }
  | { state: "billed"; final: boolean; totalCents: number; lines: BillLine[]; book: PriceBook }
  | { state: "invalid"; message: string };

function picked(draft: DraftRental, items: ChargeItem[]): { item: ChargeItem; qty: number }[] | { error: string } {
  const out: { item: ChargeItem; qty: number }[] = [];
  for (const item of items) {
    const text = draft.items[item.id];
    if (text === undefined) continue;
    const qty = parseQty(text);
    if (qty === null) return { error: `Enter how many for ${item.description}.` };
    out.push({ item, qty });
  }
  return out;
}

/** What adding this rental will do, or why it can't go in yet. Fields the browser requires (customer, day, address) aren't checked here. */
export function checkRental(draft: DraftRental, ctx: RentalContext): RentalCheck {
  const items = picked(draft, ctx.items);
  if ("error" in items) return { state: "invalid", message: items.error };
  if (draft.state === "scheduled") {
    if (draft.dropDate && draft.dropDate < ctx.today) {
      return { state: "invalid", message: "That day has passed. If the can went out, pick “Out on the job” or “Picked up and dumped”." };
    }
    if (items.length) return { state: "invalid", message: "Line items go on once the can is dropped. Untick them for a booking." };
    return { state: "scheduled" };
  }
  if (draft.dropDate > ctx.today) return { state: "invalid", message: "The drop day is after today. Book it instead." };
  const can = ctx.cans.find((c) => c.id === draft.canId);
  if (draft.state === "on_site") {
    if (!can) return { state: "invalid", message: "Pick the can that's out there." };
    if (!can.inYard) return { state: "invalid", message: `Can ${can.label} isn't in the yard in Rake. Check where it is.` };
  }
  const book = bookOn(ctx.books, draft.dropDate || ctx.today);
  if (!book) return { state: "invalid", message: "Set the dumpster prices in Settings first." };

  const lines: BillLine[] = [{ label: "Delivery", cents: book.deliveryCents }];
  if (draft.state === "done") {
    if (!draft.pickedUpOn) return { state: "invalid", message: "Enter the day it was picked up." };
    if (draft.pickedUpOn < draft.dropDate) return { state: "invalid", message: "The pickup is before the drop." };
    if (draft.pickedUpOn > ctx.today) return { state: "invalid", message: "The pickup is after today." };
    const tons = parseTons(draft.tons);
    if (tons === null) return { state: "invalid", message: "Enter the tons from the scale ticket." };
    const fee = draft.dumpFee.trim() === "" ? null : parseDollarsToCents(draft.dumpFee);
    if (fee === null) return { state: "invalid", message: "Enter the dump fee from the scale ticket, like 182.50." };
    const extra = daysBetween(draft.dropDate, draft.pickedUpOn) - book.afterDays;
    if (extra > 0 && book.perDayCents > 0) lines.push({ label: `${extra} extra ${extra === 1 ? "day" : "days"}`, cents: extra * book.perDayCents });
    lines.push({ label: `Disposal, ${tons} tons`, cents: fee });
  }
  for (const { item, qty } of items) {
    lines.push({ label: qty === 1 ? item.description : `${item.description} × ${qty}`, cents: lineCents(qty, item.unitCents) });
  }
  return { state: "billed", final: draft.state === "done", totalCents: lines.reduce((s, l) => s + l.cents, 0), lines, book };
}

export type RentalPayload = {
  customer_id: string;
  site_id?: string;
  address?: string;
  state: RentalState;
  drop_date: string;
  notes: string | null;
  can_id?: string;
  picked_up_on?: string;
  tons?: number;
  dump_fee_cents?: number;
  ticket_number?: string | null;
  landfill_id?: string;
  items: { item_id: string; qty: number }[];
  expected_total_cents?: number;
};

/** The list add_rentals takes, or the first rental that isn't ready (numbered from 1). */
export function toPayload(drafts: DraftRental[], ctx: RentalContext): { rentals: RentalPayload[] } | { error: string; rental: number } {
  const out: RentalPayload[] = [];
  for (const [i, d] of drafts.entries()) {
    const n = i + 1;
    const customer = ctx.customers.find((c) => c.id === d.customerId);
    if (!customer) return { error: "Pick the customer.", rental: n };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dropDate)) return { error: "Pick the drop day.", rental: n };
    const existing = customer.sites.find((s) => s.id === d.siteId);
    if (!existing && d.address.trim() === "") return { error: "Enter the address.", rental: n };
    const check = checkRental(d, ctx);
    if (check.state === "invalid") return { error: check.message, rental: n };
    const items = picked(d, ctx.items);
    const row: RentalPayload = {
      customer_id: customer.id,
      ...(existing ? { site_id: existing.id } : { address: d.address.trim() }),
      state: d.state,
      drop_date: d.dropDate,
      notes: d.notes.trim() || null,
      items: "error" in items ? [] : items.map(({ item, qty }) => ({ item_id: item.id, qty })),
    };
    if (d.canId && d.state !== "scheduled") row.can_id = d.canId;
    if (d.state === "done") {
      Object.assign(row, {
        picked_up_on: d.pickedUpOn,
        tons: parseTons(d.tons)!,
        dump_fee_cents: parseDollarsToCents(d.dumpFee)!,
        ticket_number: d.ticket.trim() || null,
        ...(d.landfillId ? { landfill_id: d.landfillId } : {}),
      });
    }
    if (check.state === "billed") row.expected_total_cents = check.totalCents;
    out.push(row);
  }
  return { rentals: out };
}

/** The most rentals add_rentals takes at once. */
export const MAX_RENTALS = 50;
