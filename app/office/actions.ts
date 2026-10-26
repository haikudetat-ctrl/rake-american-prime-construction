"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getMember, requireOwner, requireStaff } from "@/lib/auth";
import { orderStops } from "@/lib/dispatch/order";
import { back, errorText, optional, str } from "@/lib/flash";
import { GoogleGeocodeProvider } from "@/lib/integrations/geocode";
import { catalogSchema } from "@/lib/estimate/catalog";
import { applySection, PriceListFormError } from "@/lib/estimate/form";
import { parseRoofrText } from "@/lib/estimate/roofr";
import { activeCatalog, MEASUREMENT_COLUMNS, priceAndSaveProposal } from "@/lib/estimate/server";
import { officeLeadSchema, STAGE_LABEL, type Stage } from "@/lib/leads/schema";
import { contentHash, newProposalToken } from "@/lib/proposals/content";
import { loadFullProposal, loadProposalSettings } from "@/lib/proposals/server";
import { zonedToUtc } from "@/lib/dates";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { SITE_CONTENT_TAG } from "@/lib/site/content";
import { adminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const GALLERY_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Every action re-checks the caller's role: server actions are reachable by a
// direct POST, not just from the page that renders them. The database checks
// again underneath (RLS and the workflow functions).

async function staffClient() {
  const member = await requireStaff();
  return { member, supabase: await createSupabaseServerClient() };
}

function done(path: string, message: string): never {
  revalidatePath("/office", "layout");
  back(path, message);
}

// Requests ------------------------------------------------------------------------

export async function approveRequest(form: FormData) {
  const { supabase } = await staffClient();
  const customer = str(form, "customerId");
  const { error } = await supabase.rpc("approve_request", {
    p_request_id: str(form, "requestId"),
    p_customer_id: customer === "new" ? null : customer,
    p_drop_date: optional(form, "dropDate"),
    p_driver_id: optional(form, "driverId"),
  });
  if (error) back("/office/requests", errorText(error), "error");
  done("/office/requests", "Approved. The customer gets a confirmation text.");
}

export async function declineRequest(form: FormData) {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc("decline_request", {
    p_request_id: str(form, "requestId"),
    p_reason: optional(form, "reason"),
  });
  if (error) back("/office/requests", errorText(error), "error");
  done("/office/requests", "Declined.");
}

// Schedule ------------------------------------------------------------------------

export async function assignStop(form: FormData) {
  const { supabase } = await staffClient();
  const date = str(form, "date");
  const { error } = await supabase.rpc("assign_stop", {
    p_stop_id: str(form, "stopId"),
    p_driver_id: optional(form, "driverId"),
    p_date: optional(form, "newDate") ?? date,
  });
  if (error) back(`/office/dumpsters?date=${date}`, errorText(error), "error");
  done(`/office/dumpsters?date=${date}`, "Stop updated.");
}

export async function orderRun(form: FormData) {
  const { supabase } = await staffClient();
  const date = str(form, "date");
  const driverId = str(form, "driverId");
  const [{ data: stops }, { data: yard }] = await Promise.all([
    supabase
      .from("stops")
      .select("id, status, rentals(sites(area, lat, lng))")
      .eq("scheduled_date", date)
      .eq("driver_id", driverId)
      .eq("status", "scheduled"),
    supabase.from("yards").select("lat, lng").eq("id", str(form, "yardId")).maybeSingle(),
  ]);
  const routable = (stops ?? []).map((s) => {
    const rental = Array.isArray(s.rentals) ? s.rentals[0] : s.rentals;
    const site = Array.isArray(rental?.sites) ? rental.sites[0] : rental?.sites;
    return { id: s.id as string, area: site?.area ?? null, lat: site?.lat ?? null, lng: site?.lng ?? null };
  });
  const start = yard?.lat != null && yard?.lng != null ? { lat: yard.lat, lng: yard.lng } : null;
  const ordered = orderStops(routable, start);
  const { error } = await supabase.rpc("sequence_stops", { p_stop_ids: ordered.map((s) => s.id) });
  if (error) back(`/office/dumpsters?date=${date}`, errorText(error), "error");
  done(`/office/dumpsters?date=${date}`, "Run ordered.");
}

export async function requestPickup(form: FormData) {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc("request_pickup", {
    p_rental_id: str(form, "rentalId"),
    p_date: str(form, "date"),
    p_driver_id: optional(form, "driverId"),
  });
  if (error) back("/office/cans", errorText(error), "error");
  done("/office/cans", "Pickup scheduled.");
}

// Customers -----------------------------------------------------------------------

export async function createCustomer(form: FormData) {
  const { member, supabase } = await staffClient();
  const phone = optional(form, "phone");
  const { data, error } = await supabase
    .from("customers")
    .insert({
      company_id: member.companyId,
      name: str(form, "name"),
      billing_email: optional(form, "billingEmail"),
      phone: phone ? toE164(phone) ?? phone : null,
      payment_terms_days: Number(str(form, "terms") || 15),
    })
    .select("id")
    .single();
  if (error) back("/office/customers", errorText(error), "error");
  done(`/office/customers/${data.id}`, "Customer added.");
}

export async function updateCustomer(form: FormData) {
  const { supabase } = await staffClient();
  const id = str(form, "customerId");
  const phone = optional(form, "phone");
  const { error } = await supabase
    .from("customers")
    .update({
      name: str(form, "name"),
      billing_email: optional(form, "billingEmail"),
      phone: phone ? toE164(phone) ?? phone : null,
      payment_terms_days: Number(str(form, "terms") || 15),
      notes: optional(form, "notes"),
    })
    .eq("id", id);
  if (error) back(`/office/customers/${id}`, errorText(error), "error");
  done(`/office/customers/${id}`, "Saved.");
}

export async function addContact(form: FormData) {
  const { member, supabase } = await staffClient();
  const id = str(form, "customerId");
  const phone = optional(form, "phone");
  const { error } = await supabase.from("customer_contacts").insert({
    company_id: member.companyId,
    customer_id: id,
    name: str(form, "name"),
    phone: phone ? toE164(phone) ?? phone : null,
    email: optional(form, "email"),
  });
  if (error) back(`/office/customers/${id}`, errorText(error), "error");
  done(`/office/customers/${id}`, "Contact added.");
}

async function geocodeAddress(address: string) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    return await new GoogleGeocodeProvider(key).geocode({ address });
  } catch {
    return null;
  }
}

export async function addSite(form: FormData) {
  const { member, supabase } = await staffClient();
  const id = str(form, "customerId");
  const typed = str(form, "address");
  const place = await geocodeAddress(typed);
  const { error } = await supabase.from("sites").insert({
    company_id: member.companyId,
    customer_id: id,
    address: place?.formattedAddress ?? typed,
    area: place?.locality ?? optional(form, "area"),
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    place_id: place?.placeId ?? null,
    notes: optional(form, "notes"),
  });
  if (error) back(`/office/customers/${id}`, errorText(error), "error");
  done(`/office/customers/${id}`, place ? "Address added." : "Address added (not found on the map; it won't be routed).");
}

export async function createRental(form: FormData) {
  const { supabase } = await staffClient();
  const id = str(form, "customerId");
  const size = optional(form, "sizeYards");
  const { error } = await supabase.rpc("create_rental", {
    p_customer_id: id,
    p_site_id: str(form, "siteId"),
    p_drop_date: str(form, "dropDate"),
    p_driver_id: optional(form, "driverId"),
    p_size_yards: size ? Number(size) : null,
    p_notes: optional(form, "notes"),
  });
  if (error) back(`/office/customers/${id}`, errorText(error), "error");
  done(`/office/customers/${id}`, "Rental booked.");
}

// Cans, yards, landfills ----------------------------------------------------------

export async function addCan(form: FormData) {
  const { member, supabase } = await staffClient();
  const { error } = await supabase.from("cans").insert({
    company_id: member.companyId,
    label: str(form, "label"),
    size_yards: Number(str(form, "sizeYards")),
    home_yard_id: optional(form, "yardId"),
  });
  if (error) back("/office/cans", errorText(error), "error");
  done("/office/cans", "Can added.");
}

export async function setCanService(form: FormData) {
  const { supabase } = await staffClient();
  const inService = str(form, "inService") === "1";
  // Only a can in the yard can be taken out of (or put back into) service;
  // a can on a job moves only through the workflow.
  const { data, error } = await supabase
    .from("cans")
    .update({ status: inService ? "available" : "out_of_service" })
    .eq("id", str(form, "canId"))
    .eq("status", inService ? "out_of_service" : "available")
    .select("id");
  if (error || !data?.length) back("/office/cans", errorText(error ?? { message: "Only cans in the yard can be changed." }), "error");
  done("/office/cans", inService ? "Back in service." : "Marked out of service.");
}

export async function addPlace(form: FormData) {
  const { member, supabase } = await staffClient();
  const table = str(form, "kind") === "landfill" ? "landfills" : "yards";
  const typed = str(form, "address");
  const place = typed ? await geocodeAddress(typed) : null;
  const { error } = await supabase.from(table).insert({
    company_id: member.companyId,
    name: str(form, "name"),
    address: place?.formattedAddress ?? (typed || null),
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
  });
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "Added.");
}

// Billing -------------------------------------------------------------------------

export async function issueStatementsNow() {
  const { supabase } = await staffClient();
  const { data, error } = await supabase.rpc("issue_statements", { p_company_id: null });
  if (error) back("/office/billing", errorText(error), "error");
  const count = Array.isArray(data) ? data.length : 0;
  done("/office/billing", count ? `${count} statement${count === 1 ? "" : "s"} issued.` : "Nothing to bill.");
}

export async function recordPayment(form: FormData) {
  const { supabase } = await staffClient();
  const statementId = str(form, "statementId");
  const cents = parseDollarsToCents(str(form, "amount"));
  if (!cents) back(`/office/billing/${statementId}`, "Enter the amount received.", "error");
  const { error } = await supabase.rpc("record_payment", {
    p_statement_id: statementId,
    p_amount_cents: cents,
    p_method: str(form, "method"),
    p_reference: optional(form, "reference"),
    p_received_on: str(form, "receivedOn"),
  });
  if (error) back(`/office/billing/${statementId}`, errorText(error), "error");
  done(`/office/billing/${statementId}`, "Payment recorded.");
}

// Owner settings ------------------------------------------------------------------

export async function publishPriceBook(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const delivery = parseDollarsToCents(str(form, "deliveryFee"));
  const perDay = parseDollarsToCents(str(form, "extendedFeePerDay") || "0");
  const after = Number(str(form, "extendedAfterDays"));
  if (delivery === null || perDay === null || !Number.isInteger(after) || after < 0) {
    back("/office/settings", "Check the prices.", "error");
  }
  const { error } = await supabase.rpc("publish_price_book", {
    p_delivery_fee_cents: delivery,
    p_extended_after_days: after,
    p_extended_fee_cents_per_day: perDay,
  });
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "New prices apply to rentals booked from now on.");
}

export async function updateBrand(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const phone = optional(form, "phone");
  const { error } = await supabase
    .from("brands")
    .update({
      display_name: str(form, "displayName"),
      email: optional(form, "email"),
      phone: phone ? toE164(phone) ?? phone : null,
      address: optional(form, "address"),
    })
    .eq("id", str(form, "brandId"));
  if (error) back("/office/settings", errorText(error), "error");
  revalidateTag(SITE_CONTENT_TAG, "max"); // phone and email on the public site
  done("/office/settings", "Saved.");
}

/**
 * Adds a team member. Owners and office sign in by email; drivers by phone.
 * Uses the auth admin API (service role) because there is no self sign-up.
 */
export async function addTeamMember(form: FormData) {
  const owner = await requireOwner();
  const role = str(form, "role");
  if (!["owner", "office", "driver"].includes(role)) back("/office/settings", "Pick a role.", "error");
  const name = str(form, "name");
  const email = optional(form, "email")?.toLowerCase() ?? null;
  const phone = optional(form, "phone");
  const e164 = phone ? toE164(phone) : null;
  if (phone && !e164) back("/office/settings", "That phone number isn't a 10-digit US number.", "error");
  if (role === "driver" && !e164) back("/office/settings", "Drivers sign in by phone; add their mobile number.", "error");
  if (role !== "driver" && !email) back("/office/settings", "Office and owners sign in by email; add their email.", "error");

  const admin = adminClient();
  const created = await admin.auth.admin.createUser({
    ...(email ? { email, email_confirm: true } : {}),
    ...(e164 ? { phone: e164.slice(1), phone_confirm: true } : {}),
  });
  if (created.error || !created.data.user) back("/office/settings", errorText(created.error), "error");
  const userId = created.data.user.id;

  const [profile, membership] = await Promise.all([
    admin.from("profiles").upsert({ user_id: userId, full_name: name, phone: e164 }),
    admin.from("memberships").insert({ user_id: userId, company_id: owner.companyId, role }),
  ]);
  if (profile.error || membership.error) {
    back("/office/settings", errorText(profile.error ?? membership.error), "error");
  }
  done("/office/settings", `${name} added.`);
}

export async function setMemberActive(form: FormData) {
  const owner = await requireOwner();
  const userId = str(form, "userId");
  if (userId === owner.userId) back("/office/settings", "You can't remove yourself.", "error");
  const { error } = await adminClient()
    .from("memberships")
    .update({ is_active: str(form, "active") === "1" })
    .eq("user_id", userId)
    .eq("company_id", owner.companyId);
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "Team updated.");
}

// QuickBooks -------------------------------------------------------------------------

export async function disconnectQuickBooks() {
  const owner = await requireOwner();
  const { disconnect } = await import("@/lib/integrations/quickbooks/connection");
  await disconnect(owner.companyId);
  done("/office/settings", "QuickBooks disconnected.");
}

const QBO_ITEM_FIELDS = ["item_delivery", "item_extended_days", "item_tonnage", "item_adjustment"] as const;

export async function saveQuickBooksSync(form: FormData) {
  const owner = await requireOwner();
  const row: Record<string, unknown> = {
    company_id: owner.companyId,
    sync_enabled: form.get("syncEnabled") === "on",
    updated_by: owner.userId,
    updated_at: new Date().toISOString(),
  };
  for (const field of QBO_ITEM_FIELDS) row[field] = optional(form, field);
  // qbo_settings is server-only (no RLS policies): the owner check above is the gate.
  const { error } = await adminClient().from("qbo_settings").upsert(row);
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", row.sync_enabled ? "QuickBooks sync saved and on." : "QuickBooks sync saved (off).");
}

export async function syncQuickBooksNow() {
  const owner = await requireOwner();
  const { syncCompany } = await import("@/lib/integrations/quickbooks/sync");
  const r = await syncCompany(owner.companyId);
  if (r.skipped) back("/office/settings", `Not synced: ${r.skipped}.`, "error");
  if (r.error) back("/office/settings", r.error, "error");
  const paid = r.paymentsRecordedCents ? `, ${formatCents(r.paymentsRecordedCents)} in payments recorded` : "";
  const failed = r.failed ? `, ${r.failed} need attention` : "";
  done("/office/settings", `QuickBooks synced: ${r.pushed} invoices sent, ${r.voided} voided${paid}${failed}.`);
}

// Corrections (slice 2) --------------------------------------------------------------
// Each one is a database function that checks the role again and refuses to
// touch money already on a statement; these wrappers only route the result.

async function correction(path: string, rpc: string, args: Record<string, unknown>, ok: string): Promise<never> {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) back(path, errorText(error), "error");
  done(path, ok);
}

export async function cancelRental(form: FormData) {
  const id = str(form, "rentalId");
  await correction(`/office/rentals/${id}`, "cancel_rental", { p_rental_id: id, p_reason: str(form, "reason") }, "Rental cancelled.");
}

export async function swapCan(form: FormData) {
  const id = str(form, "rentalId");
  await correction(`/office/rentals/${id}`, "swap_can", { p_rental_id: id, p_can_id: str(form, "canId") }, "Can changed.");
}

export async function cancelPickup(form: FormData) {
  const id = str(form, "rentalId");
  await correction(`/office/rentals/${id}`, "cancel_pickup", { p_rental_id: id }, "Pickup cancelled; the can is back on the job.");
}

export async function undoStop(form: FormData) {
  const id = str(form, "rentalId");
  await correction(`/office/rentals/${id}`, "undo_stop", { p_stop_id: str(form, "stopId") }, "Step undone. It's back on the driver's run.");
}

export async function addAdjustment(form: FormData) {
  const id = str(form, "rentalId");
  const cents = parseDollarsToCents(str(form, "amount"));
  if (!cents) back(`/office/rentals/${id}`, "Enter the amount in dollars.", "error");
  const signed = str(form, "direction") === "credit" ? -cents : cents;
  await correction(
    `/office/rentals/${id}`,
    "add_invoice_adjustment",
    { p_invoice_id: str(form, "invoiceId"), p_description: str(form, "description"), p_amount_cents: signed },
    "Adjustment added.",
  );
}

export async function removeAdjustment(form: FormData) {
  const id = str(form, "rentalId");
  await correction(`/office/rentals/${id}`, "remove_invoice_adjustment", { p_line_id: str(form, "lineId") }, "Adjustment removed.");
}

export async function voidInvoice(form: FormData) {
  const id = str(form, "rentalId");
  await correction(
    `/office/rentals/${id}`,
    "void_invoice",
    { p_invoice_id: str(form, "invoiceId"), p_reason: str(form, "reason") },
    "Invoice voided. It will not be billed.",
  );
}

export async function voidStatement(form: FormData) {
  const id = str(form, "statementId");
  await correction(
    `/office/billing/${id}`,
    "void_statement",
    { p_statement_id: id, p_reason: str(form, "reason") },
    "Statement voided. Its invoices are back in “Ready to bill”.",
  );
}

// Roofing leads (phase 2) ----------------------------------------------------------

function leadFields(form: FormData) {
  return {
    name: str(form, "name"),
    phone: str(form, "phone"),
    email: str(form, "email"),
    address: str(form, "address"),
    need: str(form, "need"),
    notes: str(form, "notes"),
    source: str(form, "source"),
  };
}

export async function createLead(form: FormData) {
  const { supabase } = await staffClient();
  const parsed = officeLeadSchema.safeParse(leadFields(form));
  if (!parsed.success) back("/office/leads", parsed.error.issues[0]?.message ?? "Check the lead details.", "error");
  const v = parsed.data;
  const { data: id, error } = await supabase.rpc("create_lead", {
    p_name: v.name,
    p_phone: v.phone ?? null,
    p_email: v.email ?? null,
    p_address: v.address ?? null,
    p_need: v.need,
    p_notes: v.notes ?? null,
    p_source: v.source,
  });
  if (error) back("/office/leads", errorText(error), "error");
  done(`/office/leads/${id}`, "Lead added.");
}

export async function updateLead(form: FormData) {
  const { supabase } = await staffClient();
  const id = str(form, "leadId");
  const parsed = officeLeadSchema.safeParse(leadFields(form));
  if (!parsed.success) back(`/office/leads/${id}`, parsed.error.issues[0]?.message ?? "Check the lead details.", "error");
  const v = parsed.data;
  const { error } = await supabase.rpc("update_lead", {
    p_lead_id: id,
    p_name: v.name,
    p_phone: v.phone ?? null,
    p_email: v.email ?? null,
    p_address: v.address ?? null,
    p_need: v.need,
    p_notes: v.notes ?? null,
  });
  if (error) back(`/office/leads/${id}`, errorText(error), "error");
  done(`/office/leads/${id}`, "Saved.");
}

export async function moveLead(form: FormData) {
  const { supabase } = await staffClient();
  const id = str(form, "leadId");
  const stage = str(form, "stage");
  const appointment = optional(form, "appointmentAt");
  const { error } = await supabase.rpc("move_lead", {
    p_lead_id: id,
    p_stage: stage,
    // datetime-local has no zone; the office works in company time.
    p_appointment_at: appointment ? zonedToUtc(appointment) : null,
    p_lost_reason: optional(form, "lostReason"),
    p_note: optional(form, "note"),
  });
  const path = optional(form, "returnTo") ?? `/office/leads/${id}`;
  if (error) back(path, errorText(error), "error");
  done(path, `Moved to ${STAGE_LABEL[stage as Stage] ?? stage}.`);
}

export async function addLeadNote(form: FormData) {
  const { supabase } = await staffClient();
  const id = str(form, "leadId");
  const { error } = await supabase.rpc("add_lead_note", { p_lead_id: id, p_body: str(form, "body") });
  if (error) back(`/office/leads/${id}`, errorText(error), "error");
  done(`/office/leads/${id}`, "Note added.");
}

// Past-job photos on the public roofing link (owner only; public bucket).
export async function addGalleryPhoto(form: FormData) {
  const owner = await requireOwner();
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) back("/office/settings", "Choose a photo.", "error");
  const ext = GALLERY_TYPES[photo.type];
  if (!ext) back("/office/settings", "Use a JPEG, PNG or WebP photo.", "error");
  const db = adminClient();
  const { data: brand } = await db.from("brands").select("id").eq("company_id", owner.companyId).eq("kind", "roofing").single();
  const path = `${owner.companyId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await db.storage.from("gallery").upload(path, photo, { contentType: photo.type });
  if (uploadError) back("/office/settings", errorText(uploadError), "error");
  const { error } = await db.from("gallery_photos").insert({
    company_id: owner.companyId,
    brand_id: brand?.id,
    path,
    caption: optional(form, "caption"),
  });
  if (error) {
    await db.storage.from("gallery").remove([path]);
    back("/office/settings", errorText(error), "error");
  }
  revalidateTag(SITE_CONTENT_TAG, "max");
  done("/office/settings", "Photo added to the roofing page.");
}

export async function removeGalleryPhoto(form: FormData) {
  const owner = await requireOwner();
  const db = adminClient();
  const { data: photo } = await db
    .from("gallery_photos")
    .select("id, path")
    .eq("id", str(form, "photoId"))
    .eq("company_id", owner.companyId)
    .maybeSingle();
  if (!photo) back("/office/settings", "That photo is already gone.", "error");
  await db.from("gallery_photos").delete().eq("id", photo.id);
  await db.storage.from("gallery").remove([photo.path]);
  revalidateTag(SITE_CONTENT_TAG, "max");
  done("/office/settings", "Photo removed.");
}

// Business phone and inbox (phase 2b) -------------------------------------------------

export async function sendText(form: FormData) {
  const { supabase } = await staffClient();
  const phone = toE164(str(form, "phone"));
  const path = optional(form, "returnTo") ?? (phone ? `/office/inbox/${encodeURIComponent(phone)}` : "/office/inbox");
  if (!phone) back(path, "Enter a 10-digit mobile number.", "error");
  const { error } = await supabase.rpc("send_text", { p_phone: phone, p_body: str(form, "body") });
  if (error) back(path, errorText(error), "error");
  // Send now rather than on the next five-minute cron run.
  const { drainOutbox } = await import("@/lib/outbox/drain");
  await drainOutbox(5).catch(() => null);
  done(path, "Sent.");
}

export async function savePhoneSettings(form: FormData) {
  const owner = await requireOwner();
  const ring = str(form, "ringNumbers")
    .split(/[\n,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  const ringNumbers = ring.map((n) => toE164(n));
  if (ringNumbers.some((n) => !n)) back("/office/settings", "Each ring number needs 10 digits.", "error");
  const business = optional(form, "businessNumber");
  const businessNumber = business ? toE164(business) : null;
  if (business && !businessNumber) back("/office/settings", "The business number needs 10 digits.", "error");
  const openDays = form.getAll("openDays").map(Number).filter((d) => d >= 1 && d <= 7);
  const time = (key: string, fallback: string) => (/^\d{2}:\d{2}$/.test(str(form, key)) ? str(form, key) : fallback);
  const openTime = time("openTime", "08:00");
  const closeTime = time("closeTime", "18:00");
  if (closeTime <= openTime) back("/office/settings", "Closing time must be after opening time.", "error");
  const { error } = await adminClient().from("phone_settings").upsert({
    company_id: owner.companyId,
    business_number: businessNumber,
    ring_numbers: [...new Set(ringNumbers as string[])],
    ring_seconds: Math.min(60, Math.max(10, Number(str(form, "ringSeconds")) || 20)),
    open_days: openDays,
    open_time: openTime,
    close_time: closeTime,
    greeting: str(form, "greeting").slice(0, 600) || undefined,
    after_hours_greeting: str(form, "afterHoursGreeting").slice(0, 600) || undefined,
    notify_texts: form.get("notifyTexts") === "on",
    updated_by: owner.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "Phone settings saved.");
}

// Measurements, estimates and the roofing price list (phase 2c) ------------------------

function measurementValues(form: FormData): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of MEASUREMENT_COLUMNS) {
    const n = Number(str(form, key) || 0);
    values[key] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return values;
}

export async function uploadRoofReport(form: FormData) {
  const { supabase, member } = await staffClient();
  const leadId = str(form, "leadId");
  const file = form.get("report");
  const leadPath = `/office/leads/${leadId}`;
  if (!(file instanceof File) || file.size === 0) back(leadPath, "Choose the Roofr report PDF.", "error");
  if (file.size > 4_000_000) back(leadPath, "That PDF is over 4 MB. Enter the measurements by hand instead.", "error");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { pdfText } = await import("@/lib/estimate/roofr-pdf");
  const text = await pdfText(bytes);
  if (!text) back(leadPath, "That file isn't a readable PDF.", "error");
  const parsed = parseRoofrText(text);
  if (!parsed.squares) back(leadPath, "Couldn't find the roof area in that report. Enter the measurements by hand.", "error");

  const path = `${member.companyId}/${leadId}/${Date.now()}.pdf`;
  const { error: uploadError } = await adminClient().storage.from("roof-reports").upload(path, bytes, { contentType: "application/pdf" });
  if (uploadError) back(leadPath, errorText(uploadError), "error");
  const values: Record<string, number> = { stories: parsed.twoStorySquares ? 2 : 1, layers: parsed.twoLayerSquares ? 2 : 1 };
  for (const key of ["squares", "pitch", "eaves", "rakes", "ridges", "hips", "valleys", "step_flashing", "wall_flashing"] as const) {
    if (parsed[key] !== null) values[key] = parsed[key]!;
  }
  const { data: id, error } = await supabase.rpc("save_measurement", {
    p_lead_id: leadId, p_source: "roofr", p_report_path: path, p_values: values, p_parsed: parsed,
  });
  if (error) back(leadPath, errorText(error), "error");
  done(`${leadPath}/measure?m=${id}`, `Read ${parsed.found.length} values from the report. Check them, add counts (pipe boots, skylights, decking), then save.`);
}

export async function saveMeasurement(form: FormData) {
  const { supabase } = await staffClient();
  const leadId = str(form, "leadId");
  const from = optional(form, "fromId");
  let source = "manual";
  let reportPath: string | null = null;
  if (from) {
    const { data: prior } = await supabase.from("measurements").select("source, report_path").eq("id", from).maybeSingle();
    if (prior) ({ source, report_path: reportPath } = prior);
  }
  const values = measurementValues(form);
  if (!values.squares) back(`/office/leads/${leadId}/measure${from ? `?m=${from}` : ""}`, "Enter the roof area in squares.", "error");
  const { data: id, error } = await supabase.rpc("save_measurement", {
    p_lead_id: leadId, p_source: source, p_report_path: reportPath, p_values: values, p_parsed: null,
  });
  if (error) back(`/office/leads/${leadId}/measure`, errorText(error), "error");
  done(`/office/leads/${leadId}/estimate?m=${id}`, "Measurements saved. Choose the options to price.");
}

export async function saveEstimate(form: FormData) {
  const { member } = await staffClient();
  const leadId = str(form, "leadId");
  const measurementId = str(form, "measurementId");
  const proposalId = optional(form, "proposalId");
  const addons: Record<string, number> = {};
  for (const [key, value] of form.entries()) {
    const m = /^addon_(.+)$/.exec(key);
    if (m && form.get(`use_${m[1]}`) === "on") addons[m[1]] = Number(value) || 0;
  }
  const inputs = {
    systemIds: form.getAll("systemId").map(String).slice(0, 3),
    addons,
    includeDumpster: form.get("includeDumpster") === "on",
    includePermit: form.get("includePermit") === "on",
  };
  const retry = `/office/leads/${leadId}/estimate?m=${measurementId}${proposalId ? `&p=${proposalId}` : ""}`;
  if (inputs.systemIds.length === 0) back(retry, "Choose at least one roof system.", "error");
  let id: string;
  try {
    id = await priceAndSaveProposal({ companyId: member.companyId, actorId: member.userId, leadId, proposalId, measurementId, inputs });
  } catch (err) {
    back(retry, (err as Error).message, "error");
  }
  done(`/office/proposals/${id}`, proposalId ? "Estimate re-priced." : "Estimate drafted.");
}

export async function overrideOptionPrice(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const id = str(form, "proposalId");
  const clear = form.get("clear") === "1";
  const cents = clear ? null : parseDollarsToCents(str(form, "price"));
  if (!clear && cents === null) back(`/office/proposals/${id}`, "Enter the price in dollars.", "error");
  const { error } = await supabase.rpc("override_option_price", {
    p_proposal_id: id, p_system_id: str(form, "systemId"), p_price_cents: cents, p_reason: optional(form, "reason"),
  });
  if (error) back(`/office/proposals/${id}`, errorText(error), "error");
  done(`/office/proposals/${id}`, clear ? "Back to the calculated price." : "Price updated.");
}

export async function savePriceList(form: FormData) {
  const owner = await requireOwner();
  const supabase = await createSupabaseServerClient();
  const section = str(form, "section");
  const current = await activeCatalog(owner.companyId);
  let next = current.data;
  let needsConfirmation = current.needsConfirmation;
  if (section === "confirm") {
    needsConfirmation = form.get("confirmed") !== "on";
  } else {
    try {
      next = applySection(current.data, section, form);
    } catch (err) {
      back("/office/pricing", err instanceof PriceListFormError ? err.message : "Couldn't read that form.", "error");
    }
  }
  const valid = catalogSchema.safeParse(next);
  if (!valid.success) back("/office/pricing", valid.error.issues[0]?.message ?? "That price list isn't valid.", "error");
  const { error } = await supabase.rpc("publish_catalog", { p_data: valid.data, p_needs_confirmation: needsConfirmation });
  if (error) back("/office/pricing", errorText(error), "error");
  revalidateTag(SITE_CONTENT_TAG, "max"); // roofing systems named on the public site
  done("/office/pricing", `Price list version ${current.version + 1} published. Estimates already built keep their prices.`);
}

// Sending and signing (phase 2d) --------------------------------------------------------

export async function sendProposal(form: FormData) {
  const { supabase, member } = await staffClient();
  const id = str(form, "proposalId");
  const path = `/office/proposals/${id}`;
  // RLS first: the member must be able to see this proposal.
  const { data: visible } = await supabase.from("proposals").select("id").eq("id", id).maybeSingle();
  if (!visible) back("/office/leads", "Proposal not found.", "error");
  const p = await loadFullProposal({ id });
  if (!p) back(path, "Proposal not found.", "error");
  const settings = await loadProposalSettings(member.companyId);
  const content = { ...p.content, terms: settings.terms };
  const { error } = await adminClient().rpc("send_proposal", {
    p_company_id: member.companyId,
    p_actor: member.userId,
    p_proposal_id: id,
    p_token: newProposalToken(),
    p_content_hash: contentHash(content),
    p_terms: settings.terms,
    p_valid_days: settings.validDays,
    p_by_text: form.get("byText") === "on",
    p_by_email: form.get("byEmail") === "on",
  });
  if (error) back(path, errorText(error), "error");
  const { drainOutbox } = await import("@/lib/outbox/drain");
  await drainOutbox(5).catch(() => null);
  done(path, "Sent. The homeowner can open it, pick an option and sign on their phone.");
}

export async function reviseProposal(form: FormData) {
  const { supabase } = await staffClient();
  const { data: id, error } = await supabase.rpc("revise_proposal", { p_proposal_id: str(form, "proposalId") });
  if (error) back(`/office/proposals/${str(form, "proposalId")}`, errorText(error), "error");
  done(`/office/proposals/${id}`, "New version drafted. Change it, then send it; sending replaces the old one.");
}

export async function saveProposalSettings(form: FormData) {
  const owner = await requireOwner();
  const terms = str(form, "terms");
  if (terms.length < 20) back("/office/settings", "Enter the contract terms.", "error");
  const { error } = await adminClient().from("proposal_settings").upsert({
    company_id: owner.companyId,
    terms: terms.slice(0, 20000),
    valid_days: Math.min(365, Math.max(1, Number(str(form, "validDays")) || 30)),
    hic_number: optional(form, "hicNumber"),
    updated_by: owner.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "Proposal terms saved. Proposals already sent keep the terms they were sent with.");
}

export async function scheduleRoofingJob(form: FormData) {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc("schedule_roofing_job", {
    p_job_id: str(form, "jobId"),
    p_install_date: optional(form, "installDate"),
    p_crew_ids: form.getAll("crewId").map(String),
    p_notes: optional(form, "notes"),
  });
  if (error) back("/office/jobs", errorText(error), "error");
  done("/office/jobs", "Job updated.");
}

/** Crew and staff: start or finish a roofing job. */
export async function setRoofingJobStatus(form: FormData) {
  const member = await getMember();
  if (!member) back("/login", "Sign in first.", "error");
  const supabase = await createSupabaseServerClient();
  const returnTo = optional(form, "returnTo") ?? (member.role === "crew" ? "/crew" : "/office/jobs");
  const { error } = await supabase.rpc("set_roofing_job_status", { p_job_id: str(form, "jobId"), p_status: str(form, "status") });
  if (error) back(returnTo, errorText(error), "error");
  revalidatePath("/crew");
  done(returnTo, "Updated.");
}

// Job costing (phase 3a) -----------------------------------------------------------------

async function jobRpc(path: string, rpc: string, args: Record<string, unknown>, ok: string): Promise<never> {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) back(path, errorText(error), "error");
  done(path, ok);
}

const money = (form: FormData, key: string) => parseDollarsToCents(str(form, key));
const amount = (form: FormData, key: string) => {
  const n = Number(str(form, key));
  return Number.isFinite(n) && str(form, key) !== "" ? n : null;
};

export async function addJobCost(form: FormData) {
  const jobId = str(form, "jobId");
  const path = `/office/jobs/${jobId}`;
  const qty = amount(form, "qty");
  const unit = money(form, "unit");
  const total = money(form, "amount") ?? (qty !== null && unit !== null ? Math.round(qty * unit) : null);
  if (total === null) back(path, "Enter an amount, or a quantity and rate.", "error");
  return jobRpc(path, "add_job_cost", {
    p_job_id: jobId, p_kind: str(form, "kind"), p_description: str(form, "description"), p_amount_cents: total,
    p_qty: qty, p_unit_cents: unit, p_vendor: optional(form, "vendor"), p_reference: optional(form, "reference"),
    p_incurred_on: optional(form, "incurredOn"),
  }, "Cost added.");
}

export async function addOwnEquipment(form: FormData) {
  const jobId = str(form, "jobId");
  return jobRpc(`/office/jobs/${jobId}`, "add_own_equipment",
    { p_job_id: jobId, p_kind: str(form, "kind"), p_qty: amount(form, "qty") }, "Added at our cost.");
}

export async function voidJobCost(form: FormData) {
  return jobRpc(`/office/jobs/${str(form, "jobId")}`, "void_job_cost",
    { p_cost_id: str(form, "costId"), p_reason: str(form, "reason") }, "Cost voided.");
}

export async function pullStock(form: FormData) {
  const jobId = str(form, "jobId");
  const qty = amount(form, "qty");
  const returning = form.get("direction") === "return";
  return jobRpc(`/office/jobs/${jobId}`, "stock_pull",
    { p_item_id: str(form, "itemId"), p_job_id: jobId, p_qty: qty === null ? null : returning ? -qty : qty },
    returning ? "Returned to the shelf." : "Charged to the job at average cost.");
}

export async function recordJobPayment(form: FormData) {
  const jobId = str(form, "jobId");
  return jobRpc(`/office/jobs/${jobId}`, "record_job_payment", {
    p_job_id: jobId, p_amount_cents: money(form, "amount"), p_method: str(form, "method"),
    p_reference: optional(form, "reference"), p_received_on: optional(form, "receivedOn"),
  }, "Payment recorded.");
}

export async function voidJobPayment(form: FormData) {
  return jobRpc(`/office/jobs/${str(form, "jobId")}`, "void_job_payment",
    { p_payment_id: str(form, "paymentId"), p_reason: str(form, "reason") }, "Payment voided.");
}

export async function createStockItem(form: FormData) {
  return jobRpc("/office/stock", "create_stock_item", { p_name: str(form, "name"), p_unit: optional(form, "unit") }, "Item added.");
}

export async function buyStock(form: FormData) {
  return jobRpc("/office/stock", "stock_buy", {
    p_item_id: str(form, "itemId"), p_qty: amount(form, "qty"), p_total_cents: money(form, "total"),
    p_vendor: optional(form, "vendor"), p_reference: optional(form, "reference"), p_bought_on: optional(form, "boughtOn"),
  }, "Buy recorded; average cost updated.");
}

export async function countStock(form: FormData) {
  return jobRpc("/office/stock", "stock_count",
    { p_item_id: str(form, "itemId"), p_on_hand: amount(form, "onHand"), p_note: optional(form, "note") }, "Count updated.");
}

export async function saveCostSettings(form: FormData) {
  const owner = await requireOwner();
  const dumpster = parseDollarsToCents(str(form, "dumpster"));
  const gutter = parseDollarsToCents(str(form, "gutter"));
  if (dumpster === null || gutter === null) back("/office/settings", "Enter both costs in dollars.", "error");
  const { error } = await adminClient().from("cost_settings").upsert({
    company_id: owner.companyId, own_dumpster_cents: dumpster, own_gutter_cents_per_ft: gutter,
    updated_by: owner.userId, updated_at: new Date().toISOString(),
  });
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "Equipment costs saved. Costs already charged to jobs keep their amounts.");
}

// Reviews and referrals (phase 3b) --------------------------------------------------------

export async function markJobFinal(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const jobId = str(form, "jobId");
  const { error } = await supabase.rpc("mark_job_final", { p_job_id: jobId });
  if (error) back(`/office/jobs/${jobId}`, errorText(error), "error");
  const { drainOutbox } = await import("@/lib/outbox/drain");
  await drainOutbox(5).catch(() => null);
  done(`/office/jobs/${jobId}`, "Marked final. Warranty sent; the \"how did we do?\" text goes out tomorrow.");
}

export async function resolveFollowUp(form: FormData) {
  return jobRpc(`/office/jobs/${str(form, "jobId")}`, "resolve_follow_up",
    { p_job_id: str(form, "jobId"), p_note: str(form, "note") }, "Follow-up resolved.");
}

export async function setLeadReferrer(form: FormData) {
  const leadId = str(form, "leadId");
  return jobRpc(`/office/leads/${leadId}`, "set_lead_referrer",
    { p_lead_id: leadId, p_referrer_job_id: str(form, "referrerJobId") }, "Referral recorded.");
}

export async function markRewardPaid(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_reward_paid", {
    p_referral_id: str(form, "referralId"), p_method: str(form, "method"), p_reference: optional(form, "reference"),
  });
  if (error) back("/office/referrals", errorText(error), "error");
  done("/office/referrals", "Reward marked paid. They'll get a thank-you text.");
}

export async function voidReferral(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("void_referral", { p_referral_id: str(form, "referralId"), p_reason: str(form, "reason") });
  if (error) back("/office/referrals", errorText(error), "error");
  done("/office/referrals", "Referral voided.");
}

export async function saveReviewSettings(form: FormData) {
  const owner = await requireOwner();
  const url = optional(form, "googleReviewUrl");
  if (url && !/^https:\/\/\S+$/.test(url)) back("/office/settings", "The review link must start with https://", "error");
  const reward = parseDollarsToCents(str(form, "reward"));
  if (reward === null) back("/office/settings", "Enter the reward in dollars.", "error");
  const { error } = await adminClient().from("review_settings").upsert({
    company_id: owner.companyId,
    google_review_url: url,
    reward_cents: reward,
    feedback_delay_hours: Math.min(336, Math.max(0, Number(str(form, "feedbackDelayHours")) || 24)),
    referral_delay_days: Math.min(60, Math.max(0, Number(str(form, "referralDelayDays")) || 3)),
    updated_by: owner.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) back("/office/settings", errorText(error), "error");
  done("/office/settings", "Review and referral settings saved.");
}
