import "server-only";
import { createHash } from "node:crypto";
import { resolveAddress } from "@/lib/intake/address";
import { failedFields, formFields, isTooFast, rentalRequestSchema } from "@/lib/intake/schema";
import { issueFormToken, readFormToken } from "@/lib/intake/token";
import { adminClient } from "@/lib/supabase/admin";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "unknown_link" | "past_date" | "failed"; fields?: string[] };

/**
 * Looks up the brand behind a public link, or null if the link is unknown, off,
 * or belongs to the other business (a dumpster link never opens the roofing
 * form, and the reverse).
 */
export async function loadRequestLink(slug: string, kind: "dumpster" | "roofing" = "dumpster") {
  const { data } = await adminClient()
    .from("request_links")
    .select("slug, brand_id, brands!inner(kind, display_name, phone)")
    .eq("slug", slug)
    .eq("is_active", true)
    .eq("brands.kind", kind)
    .maybeSingle();
  if (!data) return null;
  const brand = Array.isArray(data.brands) ? data.brands[0] : data.brands;
  return {
    slug: data.slug as string,
    brandId: data.brand_id as string,
    brandName: brand?.display_name as string,
    brandPhone: brand?.phone as string | null,
  };
}

export function intakeSecret(): string {
  const secret = process.env.INTAKE_SECRET;
  if (!secret) throw new Error("Missing INTAKE_SECRET");
  return secret;
}

/** Who submitted, for rate limiting, without storing the IP itself. */
export function hashSubmitter(clientIp: string): string {
  return createHash("sha256").update(`${clientIp}:${intakeSecret()}`).digest("hex");
}

/** Signed render stamp for the request form (see lib/intake/token.ts). */
export function newFormToken(): string {
  return issueFormToken(intakeSecret());
}

/**
 * Validates and records a request from the public link. Everything the
 * submitter controls is parsed here; the database function repeats the checks
 * that matter (link active, date not past, rate limit) so they hold even if
 * this code changes.
 */
export async function submitRentalRequest(slug: string, form: FormData, clientIp: string): Promise<SubmitResult> {
  const parsed = rentalRequestSchema.safeParse(formFields(form));
  if (!parsed.success) {
    // A filled honeypot gets the same answer as success would, so bots learn nothing.
    if (form.get("website")) return { ok: true };
    return { ok: false, error: "invalid", fields: failedFields(parsed.error.issues) };
  }
  const input = parsed.data;
  const renderedAt = readFormToken(input.formToken, intakeSecret());
  // A forged token or an instant submit is a bot: answer as if it worked.
  if (renderedAt === null || isTooFast(renderedAt)) return { ok: true };

  const place = await resolveAddress(input);
  const submitterHash = hashSubmitter(clientIp);

  const { error } = await adminClient().rpc("submit_rental_request", {
    p_slug: slug,
    p_contact_name: input.contactName,
    p_company_name: input.companyName ?? null,
    p_phone: input.phone,
    p_email: input.email ?? null,
    p_address: place.address,
    p_area: place.area,
    p_lat: place.lat,
    p_lng: place.lng,
    p_place_id: place.placeId,
    p_requested_date: input.requestedDate,
    p_size_yards: input.sizeYards ?? null,
    p_notes: input.notes ?? null,
    p_submitter_hash: submitterHash,
  });
  if (!error) return { ok: true };
  if (error.hint === "rate_limited") return { ok: false, error: "rate_limited" };
  if (error.code === "P0002") return { ok: false, error: "unknown_link" };
  if (error.code === "22023") return { ok: false, error: "past_date" };
  return { ok: false, error: "failed" };
}
