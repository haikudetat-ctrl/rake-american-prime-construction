import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { qboQuery, qboRequest } from "@/lib/integrations/quickbooks/api";
import { loadConnection } from "@/lib/integrations/quickbooks/connection";
import { QboError, toQboError, type QboErrorKind } from "@/lib/integrations/quickbooks/errors";
import {
  bodyHash,
  displayName,
  invoiceBody,
  MappingMissing,
  paidCents,
  quoteQuery,
  type ItemMapping,
  type LineKind,
  type QboInvoiceBody,
} from "@/lib/integrations/quickbooks/payload";
import { one } from "@/lib/office/team";

/**
 * Slice 3: keep QuickBooks in step with Rake billing.
 *
 *  1. Push: every invoice on an issued statement (locked in Rake) is created
 *     in QuickBooks, or updated if a voided-and-reissued statement changed it.
 *     Its customer is created first, or linked if the name already exists.
 *  2. Void: an invoice voided in Rake is voided in QuickBooks.
 *  3. Pull: what QuickBooks shows as paid on each open statement's invoices
 *     is recorded in Rake as a QuickBooks payment.
 *
 * Runs from the five-minute cron and from "Sync now" in Settings. A per-company
 * claim (qbo_settings.run_started_at) keeps two runs from overlapping.
 */

const PUSH_LIMIT = 40; // per run; the cron picks up the rest five minutes later
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const LINE_ORDER: LineKind[] = ["delivery", "extended_days", "tonnage", "adjustment"];

/** Errors that affect every call, so the run stops instead of failing invoice by invoice. */
const STOPS_RUN: QboErrorKind[] = ["not_configured", "not_connected", "reconnect", "bad_credentials", "forbidden", "rate_limited", "unavailable"];

export type SyncResult = {
  companyId: string;
  skipped?: string;
  pushed: number;
  voided: number;
  paymentsRecordedCents: number;
  failed: number;
  error?: string;
};

type QboInvoice = { Id: string; SyncToken: string; TotalAmt?: number; Balance?: number; CustomerRef?: { value: string } };

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase embeds are untyped here; shaped below. */
type PendingInvoice = {
  id: string;
  status: string;
  qboInvoiceId: string | null;
  syncedHash: string | null;
  customer: { id: string; name: string; billingEmail: string | null; phone: string | null; qboCustomerId: string | null };
  rake: Parameters<typeof invoiceBody>[0] | null;
};

const PENDING_SELECT = `
  id, number, status, qbo_invoice_id, qbo_synced_hash,
  invoice_lines(kind, description, quantity, unit_cents, amount_cents, created_at),
  statements(number, issued_on, due_on),
  rentals(sites(address)),
  customers(id, name, billing_email, phone, qbo_customer_id)
`;

function shapePending(row: any): PendingInvoice {
  const statement = one(row.statements) as any;
  const customer = one(row.customers) as any;
  const lines = [...(row.invoice_lines ?? [])].sort(
    (a: any, b: any) =>
      LINE_ORDER.indexOf(a.kind) - LINE_ORDER.indexOf(b.kind) || String(a.created_at).localeCompare(String(b.created_at)),
  );
  return {
    id: row.id,
    status: row.status,
    qboInvoiceId: row.qbo_invoice_id,
    syncedHash: row.qbo_synced_hash,
    customer: {
      id: customer.id,
      name: customer.name,
      billingEmail: customer.billing_email,
      phone: customer.phone,
      qboCustomerId: customer.qbo_customer_id,
    },
    rake: statement
      ? {
          number: row.number,
          issuedOn: statement.issued_on,
          dueOn: statement.due_on,
          statementNumber: statement.number,
          siteAddress: (one((one(row.rentals) as any)?.sites) as any)?.address ?? null,
          lines: lines.map((l: any) => ({
            kind: l.kind,
            description: l.description,
            quantity: Number(l.quantity),
            unitCents: l.unit_cents,
            amountCents: l.amount_cents,
          })),
        }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Every company with sync turned on. */
export async function syncAllCompanies(): Promise<SyncResult[]> {
  const { data, error } = await adminClient().from("qbo_settings").select("company_id").eq("sync_enabled", true);
  if (error) throw new Error(error.message);
  const results: SyncResult[] = [];
  for (const row of data ?? []) results.push(await syncCompany(row.company_id));
  return results;
}

export async function syncCompany(companyId: string): Promise<SyncResult> {
  const db = adminClient();
  const result: SyncResult = { companyId, pushed: 0, voided: 0, paymentsRecordedCents: 0, failed: 0 };

  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("qbo_settings")
    .update({ run_started_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("sync_enabled", true)
    .or(`run_started_at.is.null,run_started_at.lt.${staleBefore}`)
    .select("item_delivery, item_extended_days, item_tonnage, item_adjustment")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { ...result, skipped: "sync is off or already running" };

  const items: ItemMapping = {
    delivery: claimed.item_delivery,
    extended_days: claimed.item_extended_days,
    tonnage: claimed.item_tonnage,
    adjustment: claimed.item_adjustment,
  };

  let runError: string | null = null;
  try {
    if (!(await loadConnection(companyId))) throw new QboError("not_connected");
    await pushInvoices(companyId, items, result);
    await pullPayments(companyId, result);
  } catch (err) {
    const error = err instanceof QboError ? err : toQboError(err);
    runError = error.message;
    result.error = runError;
  } finally {
    await db
      .from("qbo_settings")
      .update({ run_started_at: null, last_run_at: new Date().toISOString(), last_error: runError })
      .eq("company_id", companyId);
  }
  return result;
}

// Push ------------------------------------------------------------------------------

async function pushInvoices(companyId: string, items: ItemMapping, result: SyncResult) {
  const db = adminClient();
  const { data, error } = await db
    .from("invoices")
    .select(PENDING_SELECT)
    .eq("company_id", companyId)
    .is("qbo_voided_at", null)
    .or("status.in.(on_statement,paid),and(status.eq.void,qbo_invoice_id.not.is.null)")
    .order("number")
    .limit(500);
  if (error) throw new Error(error.message);

  const customers = new Map<string, string>(); // Rake customer id → QuickBooks Customer Id
  let calls = 0;
  for (const invoice of (data ?? []).map(shapePending)) {
    if (calls >= PUSH_LIMIT) break;
    try {
      if (invoice.status === "void") {
        calls++;
        await voidInQbo(companyId, invoice.qboInvoiceId!);
        await db.from("invoices").update({ qbo_voided_at: new Date().toISOString(), qbo_sync_error: null }).eq("id", invoice.id);
        result.voided++;
        continue;
      }
      if (!invoice.rake) continue;

      let customerRef = invoice.customer.qboCustomerId ?? customers.get(invoice.customer.id);
      if (!customerRef) {
        calls++;
        customerRef = await ensureCustomer(companyId, invoice.customer);
        customers.set(invoice.customer.id, customerRef);
      }
      const body = invoiceBody(invoice.rake, customerRef, items);
      const hash = bodyHash(body);
      if (invoice.qboInvoiceId && hash === invoice.syncedHash) continue;

      calls++;
      const saved = invoice.qboInvoiceId
        ? await updateInQbo(companyId, invoice.qboInvoiceId, body)
        : await createInQbo(companyId, body);
      await db
        .from("invoices")
        .update({
          qbo_invoice_id: saved.Id,
          qbo_sync_token: saved.SyncToken,
          qbo_synced_hash: hash,
          qbo_synced_at: new Date().toISOString(),
          qbo_sync_error: null,
        })
        .eq("id", invoice.id);
      result.pushed++;
    } catch (err) {
      if (err instanceof MappingMissing) {
        await db.from("invoices").update({ qbo_sync_error: err.message }).eq("id", invoice.id);
        result.failed++;
        continue;
      }
      const qboError = err instanceof QboError ? err : toQboError(err);
      if (STOPS_RUN.includes(qboError.kind)) throw qboError;
      const tid = qboError.intuitTid ? ` [intuit_tid ${qboError.intuitTid}]` : "";
      await db.from("invoices").update({ qbo_sync_error: qboError.message + tid }).eq("id", invoice.id);
      result.failed++;
    }
  }
}

/**
 * Create the QuickBooks customer, or link the existing one with the same
 * display name (Fault 6240, "Duplicate Name Exists"). Saves the link on the
 * Rake customer so later invoices skip this step.
 */
async function ensureCustomer(companyId: string, customer: PendingInvoice["customer"]): Promise<string> {
  const name = displayName(customer.name);
  let id: string;
  try {
    const created = await qboRequest<{ Customer: { Id: string } }>(companyId, {
      method: "POST",
      path: "customer",
      body: {
        DisplayName: name,
        ...(customer.billingEmail ? { PrimaryEmailAddr: { Address: customer.billingEmail } } : {}),
        ...(customer.phone ? { PrimaryPhone: { FreeFormNumber: customer.phone } } : {}),
      },
    });
    id = created.Customer.Id;
  } catch (err) {
    const error = err instanceof QboError ? err : toQboError(err);
    if (!error.faultCodes.includes("6240")) throw error;
    const [existing] = await qboQuery<{ Id: string }>(
      companyId,
      "Customer",
      `select * from Customer where DisplayName = ${quoteQuery(name)}`,
    );
    // The name can also belong to a vendor or employee, which an invoice can't use.
    if (!existing) throw new QboError("request", `"${name}" is already used by a QuickBooks vendor or employee; rename one of them`);
    id = existing.Id;
  }
  const { error } = await adminClient().from("customers").update({ qbo_customer_id: id }).eq("id", customer.id);
  if (error) throw new Error(error.message);
  return id;
}

async function readInvoice(companyId: string, id: string): Promise<QboInvoice> {
  const json = await qboRequest<{ Invoice: QboInvoice }>(companyId, { method: "GET", path: `invoice/${encodeURIComponent(id)}` });
  return json.Invoice;
}

/**
 * Before creating, look for an invoice with the same number for the same
 * customer: a create whose response was lost (timeout) must not be repeated.
 */
async function createInQbo(companyId: string, body: QboInvoiceBody): Promise<QboInvoice> {
  const [existing] = await qboQuery<QboInvoice>(
    companyId,
    "Invoice",
    `select * from Invoice where DocNumber = ${quoteQuery(body.DocNumber)}`,
  );
  if (existing && existing.CustomerRef?.value === body.CustomerRef.value) {
    return updateInQbo(companyId, existing.Id, body, existing);
  }
  const json = await qboRequest<{ Invoice: QboInvoice }>(companyId, { method: "POST", path: "invoice", body });
  return json.Invoice;
}

/** Sparse update with the current SyncToken (QuickBooks' optimistic lock); Line is replaced whole. */
async function updateInQbo(companyId: string, id: string, body: QboInvoiceBody, current?: QboInvoice): Promise<QboInvoice> {
  const latest = current ?? (await readInvoice(companyId, id));
  const json = await qboRequest<{ Invoice: QboInvoice }>(companyId, {
    method: "POST",
    path: "invoice",
    body: { ...body, Id: latest.Id, SyncToken: latest.SyncToken, sparse: true },
  });
  return json.Invoice;
}

async function voidInQbo(companyId: string, id: string) {
  const latest = await readInvoice(companyId, id);
  await qboRequest(companyId, {
    method: "POST",
    path: "invoice",
    params: { operation: "void" },
    body: { Id: latest.Id, SyncToken: latest.SyncToken },
  });
}

// Pull ------------------------------------------------------------------------------

async function pullPayments(companyId: string, result: SyncResult) {
  const db = adminClient();
  const { data, error } = await db
    .from("invoices")
    .select("id, statement_id, qbo_invoice_id, qbo_paid_cents, statements!inner(status)")
    .eq("company_id", companyId)
    .eq("statements.status", "open")
    .not("qbo_invoice_id", "is", null)
    .is("qbo_voided_at", null);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const paidByQboId = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => quoteQuery(r.qbo_invoice_id!));
    const found = await qboQuery<QboInvoice>(
      companyId,
      "Invoice",
      `select * from Invoice where Id IN (${ids.join(", ")}) MAXRESULTS 100`,
    );
    for (const invoice of found) paidByQboId.set(invoice.Id, paidCents(invoice));
  }

  const byStatement = new Map<string, number>();
  for (const row of rows) {
    const paid = paidByQboId.get(row.qbo_invoice_id!) ?? row.qbo_paid_cents;
    if (paid !== row.qbo_paid_cents) await db.from("invoices").update({ qbo_paid_cents: paid }).eq("id", row.id);
    byStatement.set(row.statement_id!, (byStatement.get(row.statement_id!) ?? 0) + paid);
  }

  for (const [statementId, total] of byStatement) {
    if (total <= 0) continue;
    const { data: recorded, error: rpcError } = await db.rpc("record_qbo_payments", {
      p_statement_id: statementId,
      p_qbo_paid_total_cents: total,
      p_reference: "QuickBooks",
    });
    if (rpcError) throw new Error(rpcError.message);
    result.paymentsRecordedCents += (recorded as number) ?? 0;
  }
}

// Settings --------------------------------------------------------------------------

export type QboItem = { Id: string; Name: string; Type: string };

/** Products and services an invoice line can post to. */
export async function listSalesItems(companyId: string): Promise<QboItem[]> {
  const items = await qboQuery<QboItem>(companyId, "Item", "select * from Item where Active = true MAXRESULTS 1000");
  return items.filter((i) => i.Type === "Service" || i.Type === "NonInventory").sort((a, b) => a.Name.localeCompare(b.Name));
}
