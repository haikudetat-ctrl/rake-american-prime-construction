"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requireStaff } from "@/lib/auth";
import { acknowledged, back, errorText, str } from "@/lib/flash";
import { GoogleGeocodeProvider } from "@/lib/integrations/geocode";
import { parseDollarsToCents } from "@/lib/money";
import { MAX_RENTALS, parseQty } from "@/lib/rentals/add-rentals";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Every action re-checks the caller's role; the database checks again
// underneath (RLS on the price list, role checks in the workflow functions).

const RentalsPayload = z
  .array(
    z.object({
      customer_id: z.guid(),
      site_id: z.guid().optional(),
      address: z.string().trim().min(1).max(300).optional(),
      state: z.enum(["scheduled", "on_site", "done"]),
      drop_date: z.iso.date(),
      notes: z.string().max(500).nullable(),
      can_id: z.guid().optional(),
      picked_up_on: z.iso.date().optional(),
      tons: z.number().min(0).max(99).optional(),
      dump_fee_cents: z.number().int().min(0).optional(),
      ticket_number: z.string().max(60).nullable().optional(),
      landfill_id: z.guid().optional(),
      items: z.array(z.object({ item_id: z.guid(), qty: z.number().positive().max(9999) })).max(50),
      expected_total_cents: z.number().int().min(0).optional(),
    }),
  )
  .min(1)
  .max(MAX_RENTALS);

/**
 * What the add-rentals form gets back. Refused: the message and which rental
 * (from 1) it's about. Added: where to go, with the notice, so the form can
 * clear itself.
 */
export type AddRentalsState =
  | { ok: false; error: string; rental: number | null; at: number }
  | { ok: true; href: string; at: number }
  | null;

/** Town and map position for a typed address, as Settings → addresses does it. Best effort. */
async function place(address: string) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    return await new GoogleGeocodeProvider(key).geocode({ address });
  } catch {
    return null;
  }
}

/**
 * Adds a list of rentals (a booking, a contractor's jobs, the ones nobody
 * recorded) in one go. On a refusal nothing is added and the form keeps
 * everything typed, so this answers with the error instead of redirecting.
 */
export async function addRentals(_previous: AddRentalsState, form: FormData): Promise<AddRentalsState> {
  await requireStaff();
  const supabase = await createSupabaseServerClient();
  const refuse = (error: string, rental: number | null = null): AddRentalsState => ({ ok: false, error, rental, at: Date.now() });
  let parsed: z.infer<typeof RentalsPayload>;
  try {
    parsed = RentalsPayload.parse(JSON.parse(str(form, "rentals")));
  } catch {
    return refuse("Reload the page and add the rentals again.");
  }
  const billed = parsed.filter((r) => r.state !== "scheduled");
  if (billed.length > 0 && !acknowledged(form)) return refuse("Tick the box to confirm you checked the totals.");

  // New addresses go in the way Settings adds them: as the map writes them,
  // with the town for the driver's run. That's also what the duplicate check
  // compares against.
  const rows = await Promise.all(
    parsed.map(async (r) => {
      if (r.site_id || !r.address) return r;
      const found = await place(r.address);
      return found
        ? { ...r, address: found.formattedAddress, area: found.locality, lat: found.lat, lng: found.lng, place_id: found.placeId }
        : r;
    }),
  );

  const { data, error } = await supabase.rpc("add_rentals", { p_rentals: rows });
  if (error) {
    const rental = Number(/^rental:(\d+)$/.exec(error.details ?? "")?.[1]) || null;
    // Prices changed while the list was typed: send the fresh ones down with the error.
    if (error.hint === "stale_review") revalidatePath("/office/dumpsters");
    return refuse(errorText(error), rental);
  }

  const results = (data ?? []) as { invoice_number: number | null }[];
  const numbers = results.map((r) => r.invoice_number).filter((n): n is number => n !== null);
  const booked = results.length - numbers.length;
  const parts = [results.length === 1 ? "Rental added." : `${results.length} rentals added.`];
  if (numbers.length) parts.push(`Invoice ${numbers.map((n) => `#${n}`).join(", ")}.`);
  if (booked) parts.push(`${booked === 1 ? "1 drop is" : `${booked} drops are`} on the run, unassigned.`);
  revalidatePath("/office", "layout");
  const href = new URLSearchParams({ date: parsed[0].drop_date, notice: parts.join(" ") });
  return { ok: true, href: `/office/dumpsters?${href}`, at: Date.now() };
}

// Price list ------------------------------------------------------------------------

const SETTINGS = "/office/settings";
const UNITS = ["each", "day", "ton", "hour", "trip"] as const;

/** Owner: adds a charge to the dumpster price list, or reprices the one with the same name. */
export async function saveDumpsterPriceItem(form: FormData) {
  const owner = await requireOwner();
  const supabase = await createSupabaseServerClient();
  const description = str(form, "description");
  const unit = str(form, "unit");
  const cents = parseDollarsToCents(str(form, "price"));
  if (!description) back(SETTINGS, "Name the charge, like Mattress or Dry run.", "error");
  if (!(UNITS as readonly string[]).includes(unit)) back(SETTINGS, "Pick what the charge is counted in.", "error");
  if (!cents) back(SETTINGS, "Enter the price in dollars, like 50.", "error");
  const { error } = await supabase
    .from("dumpster_price_items")
    .upsert(
      { company_id: owner.companyId, description, unit, unit_cents: cents, is_active: true },
      { onConflict: "company_id,description" },
    );
  if (error) back(SETTINGS, errorText(error), "error");
  revalidatePath("/office", "layout");
  back(SETTINGS, `${description} saved. Invoices that already have it keep the price they were given.`);
}

export async function setDumpsterPriceItemActive(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const active = str(form, "active") === "true";
  const { error } = await supabase.from("dumpster_price_items").update({ is_active: active }).eq("id", str(form, "itemId"));
  if (error) back(SETTINGS, errorText(error), "error");
  revalidatePath("/office", "layout");
  back(SETTINGS, active ? "Back on the price list." : "Taken off the price list. Invoices that have it keep it.");
}

/** Several price-list charges onto a rental's open invoice: every item with a quantity filled in. */
export async function addInvoiceCharges(form: FormData) {
  await requireStaff();
  const supabase = await createSupabaseServerClient();
  const path = `/office/rentals/${str(form, "rentalId")}`;
  const items: { item_id: string; qty: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("qty:") || String(value).trim() === "") continue;
    const qty = parseQty(String(value));
    if (qty === null) back(path, "Enter how many for each charge you picked, like 1 or 2.", "error");
    items.push({ item_id: key.slice(4), qty });
  }
  if (items.length === 0) back(path, "Fill in how many for at least one charge.", "error");
  const { error } = await supabase.rpc("add_invoice_charges", { p_invoice_id: str(form, "invoiceId"), p_items: items });
  if (error) back(path, errorText(error), "error");
  revalidatePath("/office", "layout");
  back(path, items.length === 1 ? "Charge added." : `${items.length} charges added.`);
}
