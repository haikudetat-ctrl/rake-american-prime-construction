import { disconnectQuickBooks, saveQuickBooksSync, syncQuickBooksNow } from "@/app/office/actions";
import { qboConfig } from "@/lib/integrations/quickbooks/config";
import { loadConnection } from "@/lib/integrations/quickbooks/connection";
import { LINE_KIND_LABEL, type LineKind } from "@/lib/integrations/quickbooks/payload";
import { listSalesItems, type QboItem } from "@/lib/integrations/quickbooks/sync";
import { adminClient } from "@/lib/supabase/admin";

function when(d: Date | null) {
  return d ? d.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** Owner-only. Status of the QuickBooks connection, with the sandbox test calls. */
export async function QuickBooksCard({ companyId }: { companyId: string }) {
  const config = qboConfig();
  const connection = config ? await loadConnection(companyId) : null;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">QuickBooks</h2>
        {config && <span className="pill">{config.environment}</span>}
      </div>
      {!config ? (
        <p className="text-sm text-muted">
          Not set up on this deployment. Add QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI and QBO_TOKEN_KEY.
        </p>
      ) : !connection ? (
        <>
          <p className="text-sm text-muted">Not connected.</p>
          <a className="btn" href="/api/quickbooks/connect">Connect to QuickBooks</a>
        </>
      ) : (
        <>
          <p className="text-sm">
            Connected to company <code>{connection.realmId}</code> on {when(connection.connectedAt)}.
            Access token valid until {when(connection.accessExpiresAt)} (renews automatically).
            {connection.refreshExpiresAt && <> Reconnect needed by {when(connection.refreshExpiresAt)} if unused.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary" href="/api/quickbooks/company-info" target="_blank" rel="noreferrer">Test: company info</a>
            <a className="btn-secondary" href="/api/quickbooks/userinfo" target="_blank" rel="noreferrer">Test: user info</a>
            <form action="/api/quickbooks/refresh" method="post" target="_blank">
              <button className="btn-secondary">Test: refresh token now</button>
            </form>
            <a className="btn-secondary" href="/api/quickbooks/connect">Reconnect</a>
            <form action={disconnectQuickBooks}>
              <button className="btn-secondary text-danger">Disconnect</button>
            </form>
          </div>
          <SyncSettings companyId={companyId} />
        </>
      )}
    </section>
  );
}

const ITEM_FIELD: Record<LineKind, string> = {
  delivery: "item_delivery",
  extended_days: "item_extended_days",
  tonnage: "item_tonnage",
  adjustment: "item_adjustment",
};

/** Sync on/off, which QuickBooks product/service each kind of line posts to, and what needs attention. */
async function SyncSettings({ companyId }: { companyId: string }) {
  const db = adminClient();
  const [{ data: settings }, { data: failing }, { count: synced }] = await Promise.all([
    db.from("qbo_settings").select("*").eq("company_id", companyId).maybeSingle(),
    db.from("invoices").select("id, number, qbo_sync_error").eq("company_id", companyId)
      .not("qbo_sync_error", "is", null).order("number").limit(20),
    db.from("invoices").select("id", { count: "exact", head: true }).eq("company_id", companyId)
      .not("qbo_invoice_id", "is", null),
  ]);
  let items: QboItem[] = [];
  let itemsError: string | null = null;
  try {
    items = await listSalesItems(companyId);
  } catch (err) {
    itemsError = (err as Error).message;
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <h3 className="font-semibold">Billing sync</h3>
      <p className="text-sm text-muted">
        When on, every invoice on an issued statement is sent to QuickBooks (its customer is created or linked by
        name), invoices voided here are voided there, and payments received in QuickBooks are recorded here every
        few minutes. Record payments in QuickBooks only, so they aren&apos;t counted twice.
      </p>
      {itemsError && <p className="text-sm text-danger">Couldn&apos;t load products/services: {itemsError}</p>}
      <form action={saveQuickBooksSync} className="grid gap-2 sm:grid-cols-2 sm:items-end">
        {(Object.keys(ITEM_FIELD) as LineKind[]).map((kind) => {
          const field = ITEM_FIELD[kind];
          const current = (settings?.[field] as string | null) ?? "";
          return (
            <label key={kind} className="label">
              <span>{LINE_KIND_LABEL[kind]} → QuickBooks product/service</span>
              <select name={field} className="input" defaultValue={current}>
                <option value="">Not chosen</option>
                {current && !items.some((i) => i.Id === current) && <option value={current}>Item {current}</option>}
                {items.map((i) => <option key={i.Id} value={i.Id}>{i.Name}</option>)}
              </select>
            </label>
          );
        })}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="syncEnabled" defaultChecked={settings?.sync_enabled ?? false} />
          Sync with QuickBooks
        </label>
        <button className="btn">Save</button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {settings?.sync_enabled && (
          <form action={syncQuickBooksNow}><button className="btn-secondary">Sync now</button></form>
        )}
        <span className="text-muted">
          {synced ?? 0} invoices in QuickBooks. Last run: {when(settings?.last_run_at ? new Date(settings.last_run_at) : null)}
        </span>
      </div>
      {settings?.last_error && <p className="text-sm text-danger">Last run stopped: {settings.last_error}</p>}
      {(failing ?? []).length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Invoices that didn&apos;t sync</p>
          <ul className="list-disc pl-5">
            {failing!.map((f) => <li key={f.id}>#{f.number}: {f.qbo_sync_error}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
