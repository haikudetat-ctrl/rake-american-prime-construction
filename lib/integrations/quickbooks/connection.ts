import "server-only";
import OAuthClient from "intuit-oauth";
import { adminClient } from "@/lib/supabase/admin";
import { qboConfig, requireQboConfig, type QboConfig } from "@/lib/integrations/quickbooks/config";
import { open, seal } from "@/lib/integrations/quickbooks/crypto";
import { QboError, toQboError } from "@/lib/integrations/quickbooks/errors";

/**
 * Scopes requested at connect time. Accounting for invoices and customers;
 * the OpenID scopes let us show which Intuit user connected. Payments is
 * deliberately not requested: customers pay through QuickBooks invoices.
 */
export const QBO_SCOPES = [
  OAuthClient.scopes.Accounting,
  OAuthClient.scopes.OpenId,
  OAuthClient.scopes.Profile,
  OAuthClient.scopes.Email,
  OAuthClient.scopes.Phone,
  OAuthClient.scopes.Address,
];

/** Refresh when less than this much life is left, so a call never starts on a dying token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function newOAuthClient(config: QboConfig = requireQboConfig()) {
  return new OAuthClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    environment: config.environment,
    redirectUri: config.redirectUri,
    logging: false, // the SDK's file logger would write tokens' metadata to disk
  });
}

type TokenJson = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in?: number; // seconds
};

type Row = {
  company_id: string;
  environment: "sandbox" | "production";
  realm_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: string;
  refresh_expires_at: string | null;
  connected_at: string;
  refreshed_at: string | null;
};

export type Connection = {
  companyId: string;
  environment: "sandbox" | "production";
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date | null;
  connectedAt: Date;
  refreshedAt: Date | null;
};

function expiries(json: TokenJson, now = Date.now()) {
  return {
    access_expires_at: new Date(now + json.expires_in * 1000).toISOString(),
    refresh_expires_at: json.x_refresh_token_expires_in
      ? new Date(now + json.x_refresh_token_expires_in * 1000).toISOString()
      : null,
  };
}

function decode(row: Row, key: Buffer): Connection {
  return {
    companyId: row.company_id,
    environment: row.environment,
    realmId: row.realm_id,
    accessToken: open(row.access_token_enc, key),
    refreshToken: open(row.refresh_token_enc, key),
    accessExpiresAt: new Date(row.access_expires_at),
    refreshExpiresAt: row.refresh_expires_at ? new Date(row.refresh_expires_at) : null,
    connectedAt: new Date(row.connected_at),
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at) : null,
  };
}

async function loadRow(companyId: string): Promise<Row | null> {
  const { data, error } = await adminClient()
    .from("qbo_connections")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`loading QuickBooks connection failed: ${error.message}`);
  return data as Row | null;
}

/** The stored connection, decrypted, or null. Does not refresh. */
export async function loadConnection(companyId: string): Promise<Connection | null> {
  const config = qboConfig();
  if (!config) return null;
  const row = await loadRow(companyId);
  return row ? decode(row, config.tokenKey) : null;
}

/**
 * Step 2: exchange the authorization code on the callback URL for tokens and
 * store them. `callbackUrl` is the full URL Intuit redirected to; the SDK
 * reads code and realmId from its query string.
 */
export async function completeConnection(companyId: string, callbackUrl: string, userId: string): Promise<Connection> {
  const config = requireQboConfig();
  const client = newOAuthClient(config);
  const realmId = new URL(callbackUrl).searchParams.get("realmId");
  if (!realmId) throw new QboError("request", "Intuit did not return a company (realmId)");

  let json: TokenJson;
  try {
    const response = await client.createToken(callbackUrl);
    json = response.getJson() as TokenJson;
  } catch (err) {
    throw toQboError(err);
  }

  const { error } = await adminClient().from("qbo_connections").upsert({
    company_id: companyId,
    environment: config.environment,
    realm_id: realmId,
    access_token_enc: seal(json.access_token, config.tokenKey),
    refresh_token_enc: seal(json.refresh_token, config.tokenKey),
    ...expiries(json),
    connected_by: userId,
    connected_at: new Date().toISOString(),
    refreshed_at: null,
  });
  if (error) throw new Error(`saving QuickBooks connection failed: ${error.message}`);
  return (await loadConnection(companyId))!;
}

/**
 * Step 4: exchange the refresh token for a new access token. Intuit may rotate
 * the refresh token too, so both are saved. The update is conditional on the
 * refresh token we used still being current: if two requests refresh at once,
 * the loser re-reads the winner's tokens instead of overwriting them with a
 * refresh token Intuit has already retired.
 */
export async function refreshConnection(companyId: string): Promise<Connection> {
  const config = requireQboConfig();
  const row = await loadRow(companyId);
  if (!row) throw new QboError("not_connected");
  const current = decode(row, config.tokenKey);

  let json: TokenJson;
  try {
    const response = await newOAuthClient(config).refreshUsingToken(current.refreshToken);
    json = response.getJson() as TokenJson;
  } catch (err) {
    throw toQboError(err);
  }

  const { data, error } = await adminClient()
    .from("qbo_connections")
    .update({
      access_token_enc: seal(json.access_token, config.tokenKey),
      refresh_token_enc: seal(json.refresh_token, config.tokenKey),
      ...expiries(json),
      refreshed_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("refresh_token_enc", row.refresh_token_enc)
    .select("company_id");
  if (error) throw new Error(`saving refreshed QuickBooks tokens failed: ${error.message}`);
  if (!data?.length) {
    // Another request refreshed first; use its tokens.
    const winner = await loadConnection(companyId);
    if (!winner) throw new QboError("not_connected");
    return winner;
  }
  return (await loadConnection(companyId))!;
}

/** A connection whose access token is good for at least a few more minutes. */
export async function freshConnection(companyId: string): Promise<Connection> {
  if (!qboConfig()) throw new QboError("not_configured");
  const connection = await loadConnection(companyId);
  if (!connection) throw new QboError("not_connected");
  if (connection.accessExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return connection;
  return refreshConnection(companyId);
}

/** Revoke at Intuit (best effort) and forget the tokens. */
export async function disconnect(companyId: string): Promise<void> {
  const connection = await loadConnection(companyId);
  if (connection) {
    try {
      await newOAuthClient().revoke({ refresh_token: connection.refreshToken });
    } catch {
      // Revocation failing (already revoked, network) must not keep tokens around.
    }
  }
  const { error } = await adminClient().from("qbo_connections").delete().eq("company_id", companyId);
  if (error) throw new Error(`removing QuickBooks connection failed: ${error.message}`);
}
