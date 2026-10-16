import "server-only";
import OAuthClient from "intuit-oauth";
import { freshConnection, newOAuthClient, refreshConnection, type Connection } from "@/lib/integrations/quickbooks/connection";
import { QboError, toQboError } from "@/lib/integrations/quickbooks/errors";

/**
 * Step 3: authenticated calls. Each call gets a token with life left; if
 * Intuit still answers 401 (revoked early, clock skew), refresh once and
 * retry once. A second 401 means the connection needs to be redone.
 */
async function withToken<T>(companyId: string, call: (client: OAuthClient, connection: Connection) => Promise<T>): Promise<T> {
  let connection = await freshConnection(companyId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = newOAuthClient();
    client.setToken({ access_token: connection.accessToken, realmId: connection.realmId });
    try {
      return await call(client, connection);
    } catch (err) {
      const error = toQboError(err);
      if (error.kind !== "reconnect" || attempt === 1 || error.status !== 401) throw error;
      connection = await refreshConnection(companyId);
    }
  }
  throw new QboError("reconnect");
}

/**
 * QBO Accounting: GET /v3/company/{realmId}/companyinfo/{realmId}. The SDK
 * prefixes the base URL for the configured environment
 * (sandbox-quickbooks.api.intuit.com in sandbox).
 */
export async function getCompanyInfo(companyId: string): Promise<unknown> {
  return withToken(companyId, async (client, connection) => {
    const realm = encodeURIComponent(connection.realmId);
    const response = await client.makeApiCall({ url: `v3/company/${realm}/companyinfo/${realm}`, method: "GET" });
    return response.json;
  });
}

/**
 * OpenID Connect userinfo for the Intuit user who connected. The SDK picks
 * the sandbox or production userinfo endpoint from the environment.
 */
export async function getUserInfo(companyId: string): Promise<unknown> {
  return withToken(companyId, async (client) => {
    const response = await client.getUserInfo();
    return response.getJson();
  });
}

/** Pinned so responses don't change shape under us; Intuit's current minor version. */
export const MINOR_VERSION = "75";

/**
 * A QBO Accounting API call under /v3/company/{realmId}/. `path` is relative
 * to that, e.g. "invoice" or "query".
 */
export async function qboRequest<T = unknown>(
  companyId: string,
  req: { method: "GET" | "POST"; path: string; body?: unknown; params?: Record<string, string> },
): Promise<T> {
  return withToken(companyId, async (client, connection) => {
    const realm = encodeURIComponent(connection.realmId);
    const response = await client.makeApiCall({
      url: `v3/company/${realm}/${req.path}`,
      method: req.method,
      body: req.body,
      params: { minorversion: MINOR_VERSION, ...req.params },
    });
    return response.json as T;
  });
}

/** QBO query language: SELECT ... FROM Entity WHERE ... (read-only). */
export async function qboQuery<T>(companyId: string, entity: string, query: string): Promise<T[]> {
  const json = await qboRequest<{ QueryResponse?: Record<string, T[] | undefined> }>(companyId, {
    method: "GET",
    path: "query",
    params: { query },
  });
  return json.QueryResponse?.[entity] ?? [];
}
