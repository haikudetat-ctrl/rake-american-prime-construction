"use server";

import { subQuery } from "@/lib/subcontract/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner, requireStaff } from "@/lib/auth";
import { weekStart } from "@/lib/dates";
import { back, errorText, optional, str } from "@/lib/flash";
import { formatCents, parseDollarsToCents } from "@/lib/money";
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

/** Whole or decimal squares, like 24 or 24.5. */
function parseSquares(input: string): number | null {
  const n = Number(input.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
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

export async function removeSubExtra(form: FormData) {
  const { supabase } = await staffClient();
  const { error } = await supabase.rpc("remove_sub_job_extra", { p_extra_id: str(form, "extraId") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Extra removed.");
}

export async function completeSubJob(form: FormData) {
  const { supabase } = await staffClient();
  const squares = parseSquares(str(form, "squares"));
  const pitch = parsePitch(str(form, "pitch"));
  if (squares === null) back(jobPath(form), "Enter the squares, like 24 or 24.5.", "error");
  if (pitch === null) back(jobPath(form), "Enter the pitch, like 6 or 12/12.", "error");
  const { data: invoiceId, error } = await supabase.rpc("complete_sub_job", {
    p_job_id: str(form, "jobId"),
    p_squares: squares,
    p_pitch: pitch,
  });
  if (error) back(jobPath(form), errorText(error), "error");
  const { data: invoice } = await supabase
    .from("sub_invoices")
    .select("number, total_cents, sub_contractors(billing_email)")
    .eq("id", invoiceId)
    .single();
  const email = (Array.isArray(invoice?.sub_contractors) ? invoice?.sub_contractors[0] : invoice?.sub_contractors)?.billing_email;
  done(
    jobPath(form),
    `Closed. Invoice #${invoice?.number} for ${formatCents(invoice?.total_cents)} ${
      email ? `emails to ${email} in 15 minutes.` : "is ready to download (no billing email on file)."
    }`,
  );
}

export async function reopenSubJob(form: FormData) {
  await requireOwner();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_sub_job", { p_job_id: str(form, "jobId"), p_reason: str(form, "reason") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Reopened. The invoice was voided; closing the job again issues a new one.");
}

export async function cancelSubJob(form: FormData) {
  const { supabase } = await staffClient();
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
  const { error } = await supabase.rpc("void_sub_payment", { p_payment_id: str(form, "paymentId"), p_reason: str(form, "reason") });
  if (error) back(jobPath(form), errorText(error), "error");
  done(jobPath(form), "Payment voided.");
}

// Setup -----------------------------------------------------------------------------

const SETUP = "/office/subs/setup";

export async function saveSubContractor(form: FormData) {
  const { member, supabase } = await staffClient();
  const rate = parseDollarsToCents(str(form, "rate"));
  const step = parseDollarsToCents(str(form, "pitchStep") || "0");
  const pitchFrom = Number(str(form, "pitchFrom") || "9");
  const terms = Number(str(form, "terms") || "14");
  if (rate === null || rate <= 0) back(SETUP, "Enter what they pay per square.", "error");
  if (step === null) back(SETUP, "Enter the pitch extra per square (0 if none).", "error");
  if (!Number.isInteger(pitchFrom) || pitchFrom < 1 || pitchFrom > 24) back(SETUP, "The pitch extra starts at a pitch from 1 to 24.", "error");
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) back(SETUP, "Payment terms are 0 to 120 days.", "error");
  const row = {
    name: str(form, "name"),
    billing_email: optional(form, "billingEmail"),
    phone: optional(form, "phone"),
    payment_terms_days: terms,
    cents_per_sq: rate,
    pitch_from: pitchFrom,
    pitch_step_cents: step,
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
  const step = parseDollarsToCents(str(form, "crewPitchStep") || "0");
  const pitchFrom = Number(str(form, "crewPitchFrom") || "9");
  if (rate === null || step === null || !Number.isInteger(pitchFrom) || pitchFrom < 1 || pitchFrom > 24) {
    back(SETUP, "Check the crew rates.", "error");
  }
  const { error } = await supabase.from("sub_settings").upsert({
    company_id: member.companyId,
    crew_cents_per_sq: rate,
    crew_pitch_from: pitchFrom,
    crew_pitch_step_cents: step,
    updated_by: member.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) back(SETUP, errorText(error), "error");
  done(SETUP, "Crew rates saved. They apply to jobs closed from now on.");
}
