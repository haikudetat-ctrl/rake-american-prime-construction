import "server-only";

export type QboEnvironment = "sandbox" | "production";

export type QboConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QboEnvironment;
  tokenKey: Buffer;
};

/**
 * Reads the QuickBooks app settings from the environment. The client secret
 * and token key exist only here, server-side; nothing named NEXT_PUBLIC_
 * carries them, so they cannot reach a browser bundle.
 */
export function qboConfig(): QboConfig | null {
  const { QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENVIRONMENT, QBO_TOKEN_KEY } = process.env;
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET || !QBO_REDIRECT_URI || !QBO_TOKEN_KEY) return null;
  const tokenKey = Buffer.from(QBO_TOKEN_KEY, "base64");
  if (tokenKey.length !== 32) {
    throw new Error("QBO_TOKEN_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)");
  }
  return {
    clientId: QBO_CLIENT_ID,
    clientSecret: QBO_CLIENT_SECRET,
    redirectUri: QBO_REDIRECT_URI,
    environment: QBO_ENVIRONMENT === "production" ? "production" : "sandbox",
    tokenKey,
  };
}

export function requireQboConfig(): QboConfig {
  const config = qboConfig();
  if (!config) throw new Error("QuickBooks is not configured: set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI and QBO_TOKEN_KEY");
  return config;
}
