"use server";

import { subQuery } from "@/lib/subcontract/navigation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, requireStaff } from "@/lib/auth";
import { weekStart } from "@/lib/dates";
import { acknowledged, back, errorText, optional, str } from "@/lib/flash";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { parseFingerprint } from "@/lib/subcontract/review";
import { isUnit, parsePitchTiers } from "@/lib/subcontract/tiers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Every action re-checks the caller's role; the database checks again
// underneath (RLS on the master data, role checks in the workflow functions).

async function staffClient() {
  const member = await requireStaff();
  return { member, supabase: await createSupabaseServerClient() };
}

function done(path: string, message: string): never {
  revalidatePath("/office/subs", "layout");
  revalidatePath("/office");
  back(path, message);
}

const jobPath = (form: FormData) => {
  const params = new URLSearchParams(str(form, "returnQuery").replace(/^\?/, ""));
  return `/office/subs/${str(form, "jobId")}${subQuery({ week: params.get("week"), filter: params.get("filter") })}`;
};

/** Whole or decimal squares, like 24 or 24.5. 0 is a gutter-only job. */
function parseSquares(input: string): number | null {
  if (input.trim() === "") return null;
  const n = Number(input.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
}

/** "12", "12/12" or "12:12" → 12. */
function parsePitch(input: string): number | null {
  const m = input.trim().match(/^(\d{1,2})(?:\s*[/:]\s*12)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 24 ? n : null;
}

// Jobs ------------------------------------------------------------------------------

export async function createSubJob(form: FormData) {
  const { supabase } = await staffClient();
  const date = str(form, "workDate");
  const week = /^\d{4}-\d{2}-\d{2}$/.test(date) ? weekStart(date) : "";
  const path = `/office/subs${week ? `?week=${week}` : ""}`;
  const { error } = await supabase.rpc("create_sub_job", {
    p_contractor_id: str(form, "contractorId"),
    p_work_date: optional(form, "workDate"),
    p_address: str(form, "address"),
    p_notes: optional(form, "notes"),
    p_worker_ids: form.getAll("workerId").map(String),
  });
  if (error) back(path, errorText(error), "error");
  done(path, "Job added.");
}

export async function updateSubJob(form: FormData) {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc("update_sub_job", {
    p_job_id: str(form, "jobId"),
    p_contractor_id: str(form, "contractorId"),
    p_work_date: optional(form, "workDate"),
    p_address: str(form, "address"),
    p_notes: optional(form, "notes"),
    p_worker_ids: form.getAll("workerId").map(String),
  });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Saved.");
}

export async function addSubExtra(form: FormData) {
  const { supabase } = await staffClient();
  const qty = Number(str(form, "qty"));
  const bill = parseDollarsToCents(str(form, "bill") || "0");
  const pay = parseDollarsToCents(str(form, "pay") || "0");
  if (!Number.isFinite(qty) || qty <= 0 || bill === null || pay === null) {
    back(jobPath(form), "Check how many and the dollar amounts.", "error");
  }
  const { error } = await supabase.rpc("add_sub_job_extra", {
    p_job_id: str(form, "jobId"),
    p_description: str(form, "description"),
    p_qty: qty,
    p_bill_unit_cents: bill,
    p_pay_unit_cents: pay,
  });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Extra added.");
}

/** An item from the contractor's price list, at the list's prices. */
export async function addSubPriceItem(form: FormData) {
  const { supabase } = await staffClient();
  const qty = Number(str(form, "qty").replace(/[,\s]/g, ""));
  if (!Number.isFinite(qty) || qty <= 0) back(jobPath(form), "Enter how many, like 120 (feet) or 4.", "error");
  const { error } = await supabase.rpc("add_sub_job_price_item", {
    p_job_id: str(form, "jobId"),
    p_item_id: str(form, "itemId"),
    p_qty: qty,
  });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Added from the price list.");
}

export async function removeSubExtra(form: FormData) {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc("remove_sub_job_extra", { p_extra_id: str(form, "extraId") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Extra removed.");
}

export async function completeSubJob(form: FormData) {
  const { supabase } = await staffClient();
  const squares = parseSquares(str(form, "squares"));
  // A gutter-only job has no roof pitch to give.
  const pitch = squares === 0 && str(form, "pitch") === "" ? 0 : parsePitch(str(form, "pitch"));
  if (squares === null) back(jobPath(form), "Enter the squares, like 24 or 24.5 (0 for a gutter-only job).", "error");
  if (pitch === null) back(jobPath(form), "Enter the pitch, like 6 or 12/12.", "error");
  const fingerprint = parseFingerprint(str(form, "fingerprint"));
  if (!fingerprint) back(jobPath(form), "Reload the job and review the closeout again.", "error");
  if (!acknowledged(form)) back(jobPath(form), "Tick the box to confirm you checked the closeout.", "error");
  const { data: invoiceId, error } = await supabase.rpc("complete_sub_job", {
    p_job_id: str(form, "jobId"),
    p_squares: squares,
    p_pitch: pitch,
    p_expected_fingerprint: fingerprint,
  });
  // Crew, extras or rates changed after the review loaded: nothing was written.
  // Back to a fresh review with what they typed, naming what changed (Figma 85).
  if (error?.hint === "stale_review") {
    const url = new URL(jobPath(form), "http://x");
    url.searchParams.set("stale", error.details ?? "");
    url.searchParams.set("squares", String(squares));
    url.searchParams.set("pitch", String(pitch));
    revalidatePath("/office/subs", "layout");
    redirect(`${url.pathname}${url.search}#finish`);
  }
  if (error) back(jobPath(form), errorText(error), "error");
  const { data: invoice } = await supabase
    .from("sub_invoices")
    .select("number, total_cents, sub_contractors(name, billing_email, billing)")
    .eq("id", invoiceId)
    .single();
  const gc = Array.isArray(invoice?.sub_contractors) ? invoice?.sub_contractors[0] : invoice?.sub_contractors;
  done(
    jobPath(form),
    gc?.billing === "per_job"
      ? `Closed. Invoice #${invoice?.number} for ${formatCents(invoice?.total_cents)} ${
          gc.billing_email ? `emails to ${gc.billing_email} in 15 minutes.` : "is ready to download (no billing email on file)."
        }`
      : `Closed. Invoice #${invoice?.number} for ${formatCents(invoice?.total_cents)} goes on ${gc?.name ?? "the contractor"}'s weekly statement.`,
  );
}

export async function reopenSubJob(form: FormData) {
  await requireOwner();
  if (!acknowledged(form)) back(jobPath(form), "Tick the box to confirm the reopen.", "error");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_sub_job", { p_job_id: str(form, "jobId"), p_reason: str(form, "reason") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Reopened. The invoice was voided; closing the job again issues a new one.");
}

export async function cancelSubJob(form: FormData) {
  const { supabase } = await staffClient();
  if (!acknowledged(form)) back(jobPath(form), "Tick the box to confirm the cancellation.", "error");
  const { error } = await supabase.rpc("cancel_sub_job", { p_job_id: str(form, "jobId"), p_reason: optional(form, "reason") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Job cancelled.");
}

export async function recordSubPayment(form: FormData) {
  const { supabase } = await staffClient();
  const amount = parseDollarsToCents(str(form, "amount"));
  if (amount === null) back(jobPath(form), "Enter the amount, like 2875 or 2,875.00.", "error");
  const { error } = await supabase.rpc("record_sub_payment", {
    p_invoice_id: str(form, "invoiceId"),
    p_amount_cents: amount,
    p_method: str(form, "method") || "check",
    p_reference: optional(form, "reference"),
    p_received_on: optional(form, "receivedOn"),
  });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Payment recorded.");
}

export async function voidSubPayment(form: FormData) {
  const { supabase } = await staffClient();
  if (!acknowledged(form)) back(jobPath(form), "Tick the box to confirm the void.", "error");
  const { error } = await supabase.rpc("void_sub_payment", { p_payment_id: str(form, "paymentId"), p_reason: str(form, "reason") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Payment voided.");
}

// Weekly statements ------------------------------------------------------------------

const STATEMENTS = "/office/subs/statements";

/** Bill one contractor now for every closed job waiting, and email the statement. */
export async function issueSubStatement(form: FormData) {
  const { supabase } = await staffClient();
  if (!acknowledged(form)) back(STATEMENTS, "Tick the box to confirm the statement.", "error");
  const { data: id, error } = await supabase.rpc("issue_sub_statement", { p_contractor_id: str(form, "contractorId") });
  if (error) back(STATEMENTS, errorText(error), "error");
  // Send it now rather than on the next cron run.
  const { drainOutbox } = await import("@/lib/outbox/drain");
  await drainOutbox(5).catch(() => null);
  revalidatePath("/office/subs", "layout");
  back(`${STATEMENTS}/${id}`, "Statement issued.");
}

export async function recordSubStatementPayment(form: FormData) {
  const { supabase } = await staffClient();
  const id = str(form, "statementId");
  const amount = parseDollarsToCents(str(form, "amount"));
  if (amount === null) back(`${STATEMENTS}/${id}`, "Enter the amount, like 2875 or 2,875.00.", "error");
  const { error } = await supabase.rpc("record_sub_statement_payment", {
    p_statement_id: id,
    p_amount_cents: amount,
    p_method: str(form, "method") || "check",
    p_reference: optional(form, "reference"),
    p_received_on: optional(form, "receivedOn"),
  });
  if (error) back(`${STATEMENTS}/${id}`, errorText(error), "error");
  done(`${STATEMENTS}/${id}`, "Payment recorded against the statement's jobs, oldest first.");
}

export async function voidSubStatement(form: FormData) {
  await requireOwner();
  const id = str(form, "statementId");
  if (!acknowledged(form)) back(`${STATEMENTS}/${id}`, "Tick the box to confirm the void.", "error");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("void_sub_statement", { p_statement_id: id, p_reason: str(form, "reason") });
  if (error) back(`${STATEMENTS}/${id}`, errorText(error), "error");
  done(`${STATEMENTS}/${id}`, "Statement voided. Its jobs are waiting again; fix them, then issue a new statement.");
}

// Setup -----------------------------------------------------------------------------

const SETUP = "/office/subs/setup";

export async function saveSubContractor(form: FormData) {
  const { member, supabase } = await staffClient();
  const rate = parseDollarsToCents(str(form, "rate"));
  const tiers = parsePitchTiers(str(form, "pitchTiers"));
  const minimumText = str(form, "minimum");
  const minimum = minimumText === "" ? null : parseDollarsToCents(minimumText);
  const terms = Number(str(form, "terms") || "14");
  if (rate === null || rate <= 0) back(SETUP, "Enter what they pay per square.", "error");
  if ("error" in tiers) back(SETUP, tiers.error, "error");
  if (minimumText !== "" && (minimum === null || minimum <= 0)) back(SETUP, "Enter the minimum in dollars, or leave it blank for none.", "error");
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) back(SETUP, "Payment terms are 0 to 120 days.", "error");
  const row = {
    name: str(form, "name"),
    billing_email: optional(form, "billingEmail"),
    phone: optional(form, "phone"),
    payment_terms_days: terms,
    cents_per_sq: rate,
    pitch_tiers: tiers.tiers,
    min_job_cents: minimum,
    billing: str(form, "billing") === "per_job" ? "per_job" : "weekly",
    notes: optional(form, "notes"),
    is_active: form.get("active") !== null || !form.get("id"),
  };
  const id = optional(form, "id");
  const { error } = id
    ? await supabase.from("sub_contractors").update(row).eq("id", id)
    : await supabase.from("sub_contractors").insert({ ...row, company_id: member.companyId });
  if (error) back(SETUP, error.code === "23505" ? "There's already a contractor with that name." : errorText(error), "error");
  done(SETUP, id ? "Contractor saved." : "Contractor added.");
}

/** Adds an item to a contractor's price list, or updates the one with the same name. */
export async function saveSubPriceItem(form: FormData) {
  const { member, supabase } = await staffClient();
  const bill = parseDollarsToCents(str(form, "bill"));
  const pay = parseDollarsToCents(str(form, "pay") || "0");
  const unit = str(form, "unit");
  const description = str(form, "description");
  if (!description) back(SETUP, "Name the item, like 5\" K-style gutter.", "error");
  if (!isUnit(unit)) back(SETUP, "Pick what the item is counted in.", "error");
  if (bill === null || pay === null) back(SETUP, "Enter what the contractor pays and what the crew gets (0 is fine).", "error");
  const { error } = await supabase.from("sub_price_items").upsert(
    {
      company_id: member.companyId,
      contractor_id: str(form, "contractorId"),
      description,
      unit,
      bill_unit_cents: bill,
      pay_unit_cents: pay,
      is_active: true,
    },
    { onConflict: "contractor_id,description" },
  );
  if (error) back(SETUP, errorText(error), "error");
  done(SETUP, `${description} saved. It applies to items added to jobs from now on.`);
}

export async function setSubPriceItemActive(form: FormData) {
  const { supabase } = await staffClient();
  const active = str(form, "active") === "true";
  const { error } = await supabase.from("sub_price_items").update({ is_active: active }).eq("id", str(form, "itemId"));
  if (error) back(SETUP, errorText(error), "error");
  done(SETUP, active ? "Back on the price list." : "Taken off the price list. Jobs that already have it keep it.");
}

export async function addSubWorker(form: FormData) {
  const { member, supabase } = await staffClient();
  const { error } = await supabase
    .from("sub_workers")
    .insert({ company_id: member.companyId, name: str(form, "name"), phone: optional(form, "phone") });
  if (error) back(SETUP, error.code === "23505" ? "There's already someone with that name." : errorText(error), "error");
  done(SETUP, "Added to the crew.");
}

export async function setSubWorkerActive(form: FormData) {
  const { supabase } = await staffClient();
  const active = str(form, "active") === "true";
  const { error } = await supabase.from("sub_workers").update({ is_active: active }).eq("id", str(form, "workerId"));
  if (error) back(SETUP, errorText(error), "error");
  done(SETUP, active ? "Back on the crew list." : "Taken off the crew list. Past jobs and pay stay as they were.");
}

export async function saveSubSettings(form: FormData) {
  const { member, supabase } = await staffClient();
  const rate = parseDollarsToCents(str(form, "crewRate"));
  const tiers = parsePitchTiers(str(form, "crewPitchTiers"));
  if (rate === null) back(SETUP, "Check the crew rate per square.", "error");
  if ("error" in tiers) back(SETUP, tiers.error, "error");
  const { error } = await supabase.from("sub_settings").upsert({
    company_id: member.companyId,
    crew_cents_per_sq: rate,
    crew_pitch_tiers: tiers.tiers,
    updated_by: member.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) back(SETUP, errorText(error), "error");
  done(SETUP, "Crew rates saved. They apply to jobs closed from now on.");
}
