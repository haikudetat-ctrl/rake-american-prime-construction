import { disconnectQuickBooks } from "@/app/office/actions";
import { qboConfig } from "@/lib/integrations/quickbooks/config";
import { loadConnection } from "@/lib/integrations/quickbooks/connection";

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
        </>
      )}
    </section>
  );
}
