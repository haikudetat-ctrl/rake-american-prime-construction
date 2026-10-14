# QuickBooks Online — sandbox connection

Built on Intuit's official Node SDK, [`intuit-oauth`](https://github.com/intuit/oauth-jsclient)
(authorization-code flow). Endpoints come from the SDK's own constants, not hand-typed URLs.

| Step | Where | What happens |
|---|---|---|
| 1. Authorize | `GET /api/quickbooks/connect` | Owner only. Random `state` in an HttpOnly cookie; redirect to `https://appcenter.intuit.com/connect/oauth2` with `response_type=code`, scopes `com.intuit.quickbooks.accounting openid profile email phone address`. |
| 2. Exchange code | `GET /api/quickbooks/callback` | Verifies `state`, exchanges `code` at `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` (Basic auth with client id/secret), stores tokens AES-256-GCM-encrypted in `qbo_connections` with `realmId`. |
| 3. Call APIs | `GET /api/quickbooks/company-info`, `GET /api/quickbooks/userinfo` | CompanyInfo (`/v3/company/{realmId}/companyinfo/{realmId}` on `sandbox-quickbooks.api.intuit.com`) and OpenID userinfo (`sandbox-accounts.platform.intuit.com`). |
| 4. Refresh | automatic; `POST /api/quickbooks/refresh` to force | Refreshes when < 5 min of access-token life remains, and once on a 401. Saves the rotated refresh token; concurrent refreshes don't clobber each other. |

Payments (`com.intuit.quickbooks.payment`) is intentionally not requested — customers pay through
QuickBooks invoices, so the app never charges cards.

## Run locally against the sandbox

1. In the Intuit developer portal → your app → **Keys & credentials** (Development / sandbox keys):
   add redirect URI `http://localhost:3000/api/quickbooks/callback`. Intuit only redirects to URIs
   listed there, exactly.
2. Add to `.env.local` (never commit it; `.env*` is git-ignored):
   ```dotenv
   QBO_CLIENT_ID=<Client ID from Keys & credentials>
   QBO_CLIENT_SECRET=<Client Secret from Keys & credentials>
   QBO_REDIRECT_URI=http://localhost:3000/api/quickbooks/callback
   QBO_ENVIRONMENT=sandbox
   QBO_TOKEN_KEY=<output of: openssl rand -base64 32>
   ```
   plus the Supabase variables from `.env.example`.
3. `npm run dev`, sign in as an owner, open **Settings → QuickBooks → Connect to QuickBooks**,
   approve, and pick your sandbox company.
4. Use the card's buttons: **company info**, **user info**, **refresh token now**. Each returns JSON;
   errors come back as `{ error, message, intuit_tid }` — give Intuit support the `intuit_tid`.

## Deployed (Vercel)

Add a second redirect URI for the deployment, e.g.
`https://rake-american-prime-construction.vercel.app/api/quickbooks/callback`, set the same five
variables in Vercel (secret and token key as **Sensitive**), and redeploy. Production keys require
Intuit's app assessment; switch `QBO_ENVIRONMENT=production` only after that.

## Errors

| Situation | What the owner sees |
|---|---|
| Refresh token expired/revoked (`invalid_grant`, repeated 401) | "Connect it again in Settings" |
| Wrong client id/secret (`invalid_client`) | "Check the deployment settings" |
| 403 / 429 / 5xx | Permission, rate-limit, or try-again message |
| QuickBooks validation Fault (400) | The Fault's message and detail |
