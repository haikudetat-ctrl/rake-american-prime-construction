"use server";

import { revalidatePath } from "next/cache";
import { requireDriver } from "@/lib/auth";
import { companyToday } from "@/lib/dates";
import { errorText, optional, str } from "@/lib/flash";
import { isLocale } from "@/lib/i18n";
import { parseDollarsToCents } from "@/lib/money";
import { adminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Drivers call the same workflow functions as the office. The database checks
// that the stop is assigned to the caller, so a driver cannot complete
// someone else's stop by editing the form.

export async function completeStop(form: FormData): Promise<ActionResult> {
  await requireDriver();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("complete_stop", {
    p_stop_id: str(form, "stopId"),
    p_can_id: optional(form, "canId"),
  });
  revalidatePath("/driver");
  return error ? { ok: false, error: errorText(error) } : { ok: true };
}

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export async function recordTicket(form: FormData): Promise<ActionResult> {
  const member = await requireDriver();
  const supabase = await createSupabaseServerClient();
  const stopId = str(form, "stopId");
  const tons = Number(str(form, "tons"));
  const fee = parseDollarsToCents(str(form, "fee"));
  if (!Number.isFinite(tons) || tons < 0 || fee === null) return { ok: false, error: "Check tons and fee." };

  // Confirm the stop is this driver's before storing anything for it.
  // (Staff covering a run can record any stop; the RPC enforces the same rule.)
  const date = str(form, "date") || companyToday();
  if (member.role === "driver") {
    const { data: run } = await supabase.rpc("driver_run", { p_date: date });
    if (!(run ?? []).some((s: { stop_id: string }) => s.stop_id === stopId)) {
      return { ok: false, error: "That stop isn't on your run." };
    }
  }

  let photoPath: string | null = null;
  const photo = form.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const ext = PHOTO_TYPES[photo.type];
    if (!ext) return { ok: false, error: "Photo must be a picture." };
    photoPath = `${member.companyId}/${stopId}-${Date.now()}.${ext}`;
    const { error } = await adminClient()
      .storage.from("scale-tickets")
      .upload(photoPath, photo, { contentType: photo.type, upsert: false });
    if (error) return { ok: false, error: errorText(error) };
  }

  const { error } = await supabase.rpc("record_scale_ticket", {
    p_stop_id: stopId,
    p_landfill_id: optional(form, "landfillId"),
    p_ticket_number: optional(form, "ticketNumber"),
    p_tons: tons,
    p_fee_cents: fee,
    p_photo_path: photoPath,
  });
  if (error) {
    if (photoPath) await adminClient().storage.from("scale-tickets").remove([photoPath]);
    return { ok: false, error: errorText(error) };
  }
  revalidatePath("/driver");
  return { ok: true };
}

export async function setLocale(form: FormData) {
  const member = await requireDriver();
  const locale = str(form, "locale");
  if (!isLocale(locale)) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("profiles").update({ locale }).eq("user_id", member.userId);
  revalidatePath("/driver");
}
