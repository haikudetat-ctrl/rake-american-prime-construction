import "server-only";
import { geocode, hashSubmitter, intakeSecret } from "@/lib/intake/submit";
import { isTooFast } from "@/lib/intake/schema";
import { readFormToken } from "@/lib/intake/token";
import { CONTACT_CONSENT, leadRequestSchema, MAX_PHOTOS, PHOTO_TYPES } from "@/lib/leads/schema";
import { adminClient } from "@/lib/supabase/admin";

export type LeadSubmitResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "unknown_link" | "failed"; fields?: string[] };

/**
 * Validates and records a homeowner's request from the public roofing link,
 * then stores their photos. The database function repeats the checks that
 * matter (link active and roofing, rate limit).
 */
export async function submitLeadRequest(slug: string, form: FormData, clientIp: string): Promise<LeadSubmitResult> {
  return submit({ via: "link", slug }, form, clientIp);
}

/** A friend's request through a past customer's referral link (/r/<code>). */
export async function submitReferralLead(code: string, form: FormData, clientIp: string): Promise<LeadSubmitResult> {
  return submit({ via: "referral", code }, form, clientIp);
}

async function submit(
  target: { via: "link"; slug: string } | { via: "referral"; code: string },
  form: FormData,
  clientIp: string,
): Promise<LeadSubmitResult> {
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = leadRequestSchema.safeParse(fields);
  if (!parsed.success) {
    // A filled honeypot gets the same answer as success would, so bots learn nothing.
    if (form.get("website")) return { ok: true };
    return { ok: false, error: "invalid", fields: parsed.error.issues.map((i) => String(i.path[0])) };
  }
  const input = parsed.data;
  const renderedAt = readFormToken(input.formToken, intakeSecret());
  if (renderedAt === null || isTooFast(renderedAt)) return { ok: true };

  const photos = form
    .getAll("photos")
    .filter((p): p is File => p instanceof File && p.size > 0 && p.type in PHOTO_TYPES)
    .slice(0, MAX_PHOTOS);

  const place = await geocode(input.address);
  const db = adminClient();
  const common = {
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email ?? null,
    p_address: place?.formattedAddress ?? input.address,
    p_area: place?.locality ?? null,
    p_lat: place?.lat ?? null,
    p_lng: place?.lng ?? null,
    p_place_id: place?.placeId ?? null,
    p_need: input.need,
    p_notes: input.notes ?? null,
    p_consent_text: input.consent ? CONTACT_CONSENT : null,
    p_submitter_hash: hashSubmitter(clientIp),
  };
  const { data: leadId, error } = target.via === "link"
    ? await db.rpc("submit_lead_request", { p_slug: target.slug, ...common })
    : await db.rpc("submit_referral_lead", { p_code: target.code, ...common });
  if (error) {
    if (error.hint === "rate_limited") return { ok: false, error: "rate_limited" };
    if (error.code === "P0002") return { ok: false, error: "unknown_link" };
    return { ok: false, error: "failed" };
  }

  // Photos are a bonus: the lead is already saved, so a failed upload is dropped quietly.
  const { data: lead } = await db.from("leads").select("company_id").eq("id", leadId).single();
  for (const [i, photo] of photos.entries()) {
    const path = `${lead?.company_id}/${leadId}/${i + 1}.${PHOTO_TYPES[photo.type]}`;
    const { error: uploadError } = await db.storage
      .from("lead-photos")
      .upload(path, photo, { contentType: photo.type, upsert: false });
    if (!uploadError) await db.from("lead_photos").insert({ company_id: lead?.company_id, lead_id: leadId, path });
  }
  return { ok: true };
}

/** Who sent this referral link, for the friend's page. Null if the code is unknown. */
export async function loadReferrer(code: string): Promise<{ firstName: string; companyId: string; brandId: string | null } | null> {
  if (!/^[2-9A-Za-z]{8}$/.test(code)) return null;
  const db = adminClient();
  const { data } = await db.from("aftercare").select("customer_name, company_id").eq("referral_code", code.toUpperCase()).maybeSingle();
  if (!data) return null;
  const { data: brand } = await db.from("brands").select("id").eq("company_id", data.company_id).eq("kind", "roofing").maybeSingle();
  return { firstName: data.customer_name.split(/\s+/)[0], companyId: data.company_id, brandId: brand?.id ?? null };
}

/** Past-job photos for the public page, newest arrangement first. */
export async function loadGallery(brandId: string): Promise<{ url: string; caption: string | null }[]> {
  const db = adminClient();
  const { data } = await db.from("gallery_photos").select("path, caption").eq("brand_id", brandId).order("sort").order("created_at");
  return (data ?? []).map((p) => ({ url: db.storage.from("gallery").getPublicUrl(p.path).data.publicUrl, caption: p.caption }));
}
