/**
 * One error type for everything QuickBooks-related, carrying what the person
 * should do next and Intuit's transaction id (intuit_tid), which Intuit
 * support asks for when investigating a failed call.
 */
export type QboErrorKind =
  | "not_configured"
  | "not_connected"
  | "reconnect" // refresh token expired or revoked: the owner must connect again
  | "bad_credentials" // client id/secret wrong
  | "forbidden"
  | "rate_limited"
  | "unavailable"
  | "request";

const ADVICE: Record<QboErrorKind, string> = {
  not_configured: "QuickBooks isn't set up on this deployment yet.",
  not_connected: "QuickBooks isn't connected. An owner can connect it in Settings.",
  reconnect: "The QuickBooks connection expired or was revoked. Connect it again in Settings.",
  bad_credentials: "QuickBooks rejected the app's client ID or secret. Check the deployment settings.",
  forbidden: "QuickBooks refused access. The connected user may lack permission for this.",
  rate_limited: "QuickBooks is rate-limiting requests. Try again in a minute.",
  unavailable: "QuickBooks is temporarily unavailable. Try again shortly.",
  request: "QuickBooks rejected the request.",
};

export class QboError extends Error {
  constructor(
    readonly kind: QboErrorKind,
    detail?: string,
    readonly intuitTid?: string,
    readonly status?: number,
    /** QuickBooks Fault error codes, e.g. "6240" for a duplicate customer name. */
    readonly faultCodes: string[] = [],
  ) {
    super(detail ? `${ADVICE[kind]} (${detail})` : ADVICE[kind]);
    this.name = "QboError";
  }

  toJSON() {
    return { error: this.kind, message: this.message, intuit_tid: this.intuitTid ?? null };
  }
}

const CODE_STATUS: Record<string, number> = { RATE_LIMIT_EXCEEDED: 429, INTERNAL_SERVER_ERROR: 500 };

type SdkError = {
  error?: string;
  error_description?: string;
  code?: string;
  description?: string;
  intuit_tid?: string;
  intuitTid?: string;
  status?: number;
  response?: { status?: number };
  authResponse?: { response?: { status?: number } };
  fault?: { errors?: Array<{ message?: string; detail?: string; code?: string }> };
  message?: string;
};

/**
 * Maps whatever intuit-oauth threw (OAuth2 errors from the token endpoint,
 * OAuthError/TokenError from API calls) onto a QboError.
 */
export function toQboError(err: unknown): QboError {
  if (err instanceof QboError) return err;
  const e = (err ?? {}) as SdkError;
  const tid = e.intuit_tid ?? e.intuitTid;
  // intuit-oauth's makeApiCall reports the HTTP status in `code` ("401",
  // "RATE_LIMIT_EXCEEDED", ...) rather than a status field.
  const status =
    e.status ??
    e.response?.status ??
    e.authResponse?.response?.status ??
    // A Fault's code is a QuickBooks error number (e.g. "610"), not an HTTP status.
    (!e.fault && e.code && /^\d{3}$/.test(e.code) ? Number(e.code) : undefined) ??
    CODE_STATUS[e.code ?? ""];
  const oauthCode = e.error ?? e.code;
  const faultCodes = (e.fault?.errors ?? []).map((f) => f.code).filter((c): c is string => Boolean(c));
  const detail =
    e.fault?.errors?.map((f) => [f.message, f.detail].filter(Boolean).join(": ")).join("; ") ||
    e.error_description ||
    e.description ||
    e.message;

  if (oauthCode === "invalid_grant") return new QboError("reconnect", detail, tid, status);
  if (oauthCode === "invalid_client") return new QboError("bad_credentials", detail, tid, status);
  if (status === 401) return new QboError("reconnect", detail, tid, status);
  if (status === 403) return new QboError("forbidden", detail, tid, status);
  if (status === 429) return new QboError("rate_limited", detail, tid, status);
  if (status !== undefined && status >= 500) return new QboError("unavailable", detail, tid, status);
  if (e.code === "NETWORK_ERROR" || e.code === "TIMEOUT_ERROR") return new QboError("unavailable", detail, tid);
  return new QboError("request", detail, tid, status, faultCodes);
}
