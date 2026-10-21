"use server";

import { revalidatePath } from "next/cache";
import { requireDriver, requireTeamMember } from "@/lib/auth";
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

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Drop and pickup photos per stop (the database allows up to 4). */
const MAX_STOP_PHOTOS = 2;

/** True when the stop is on this driver's run for that day. Staff covering a run may work any stop. */
async function onMyRun(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  role: string,
  stopId: string,
  date: string,
): Promise<boolean> {
  if (role !== "driver") return true;
  const { data: run } = await supabase.rpc("driver_run", { p_date: date });
  return (run ?? []).some((s: { stop_id: string }) => s.stop_id === stopId);
}

/**
 * Drop or pickup. Neither is done without a photo (where the can sits, or
 * the load before lifting it); the database refuses one too, so the rule
 * holds whatever screen calls it.
 */
export async function completeStop(form: FormData): Promise<ActionResult> {
  const member = await requireDriver();
  const supabase = await createSupabaseServerClient();
  const stopId = str(form, "stopId");

  const photos = form.getAll("photo").filter((p): p is File => p instanceof File && p.size > 0).slice(0, MAX_STOP_PHOTOS);
  if (photos.length === 0) return { ok: false, error: "Take the photo first." };
  if (photos.some((p) => !PHOTO_TYPES[p.type])) return { ok: false, error: "Photo must be a picture." };
  if (!(await onMyRun(supabase, member.role, stopId, str(form, "date") || companyToday()))) {
    return { ok: false, error: "That stop isn't on your run." };
  }

  const bucket = adminClient().storage.from("stop-photos");
  const paths: string[] = [];
  for (const [i, photo] of photos.entries()) {
    const path = `${member.companyId}/${stopId}-${Date.now()}-${i + 1}.${PHOTO_TYPES[photo.type]}`;
    const { error } = await bucket.upload(path, photo, { contentType: photo.type, upsert: false });
    if (error) {
      if (paths.length) await bucket.remove(paths);
      return { ok: false, error: errorText(error) };
    }
    paths.push(path);
  }

  const { error } = await supabase.rpc("complete_stop", {
    p_stop_id: stopId,
    p_can_id: optional(form, "canId"),
    p_photo_paths: paths,
  });
  if (error) {
    await bucket.remove(paths);
    return { ok: false, error: errorText(error) };
  }
  revalidatePath("/driver");
  return { ok: true };
}

export async function recordTicket(form: FormData): Promise<ActionResult> {
  const member = await requireDriver();
  const supabase = await createSupabaseServerClient();
  const stopId = str(form, "stopId");
  const tons = Number(str(form, "tons"));
  const fee = parseDollarsToCents(str(form, "fee"));
  if (!Number.isFinite(tons) || tons < 0 || fee === null) return { ok: false, error: "Check tons and fee." };

  // Confirm the stop is this driver's before storing anything for it.
  // (Staff covering a run can record any stop; the RPC enforces the same rule.)
  if (!(await onMyRun(supabase, member.role, stopId, str(form, "date") || companyToday()))) {
    return { ok: false, error: "That stop isn't on your run." };
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

/** Anyone on the team (drivers, crew, staff) picks their language. */
export async function setLocale(form: FormData) {
  const member = await requireTeamMember();
  const locale = str(form, "locale");
  if (!isLocale(locale)) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("profiles").update({ locale }).eq("user_id", member.userId);
  revalidatePath("/driver");
  revalidatePath("/crew");
}
