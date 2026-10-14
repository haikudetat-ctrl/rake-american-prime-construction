"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, requireStaff } from "@/lib/auth";
import { orderStops } from "@/lib/dispatch/order";
import { back, errorText, optional, str } from "@/lib/flash";
import { GoogleGeocodeProvider } from "@/lib/integrations/geocode";
import { parseDollarsToCents } from "@/lib/money";
import { toE164 } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  if (error) back(`/office?date=${date}`, errorText(error), "error");
  done(`/office?date=${date}`, "Stop updated.");
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
  if (error) back(`/office?date=${date}`, errorText(error), "error");
  done(`/office?date=${date}`, "Run ordered.");
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
