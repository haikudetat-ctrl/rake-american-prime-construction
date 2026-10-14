/**
 * Address → coordinates and town. Adapted from 2stack-roof-quote lib/geo.
 *
 * Here the result orders a driver's run and tells the office what town a can
 * is in, so a loose match is tolerable: the office sees the formatted address
 * when approving and can correct it.
 *
 * Billing: $5 per 1,000 requests.
 */

const ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const TIMEOUT_MS = 10_000;

export type GeocodePrecision =
  | "ROOFTOP"
  | "RANGE_INTERPOLATED"
  | "GEOMETRIC_CENTER"
  | "APPROXIMATE";

export type GeocodeResult = {
  formattedAddress: string;
  placeId: string | null;
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  /** Google set `partial_match` — it did not find an exact match for the input. */
  partialMatch: boolean;
  /** Two-letter state code, or null if the response carried no state component. */
  state: string | null;
  postalCode: string | null;
  /** Town (locality), used to group a driver's run by area. */
  locality: string | null;
  raw: unknown;
};

export type GeocodeInput = { address: string };

export interface GeocodeProvider {
  readonly name: string;
  geocode(input: GeocodeInput): Promise<GeocodeResult>;
}

/* ------------------------------------------------------------------ */
/* Error taxonomy                                                      */
/*                                                                     */
/* Mirrors lib/providers/measurement.ts deliberately. The job queue     */
/* discriminates on `terminal` alone and does not care which stage      */
/* raised: retrying a bad address never produces a good one, retrying   */
/* a 5xx often does.                                                    */
/* ------------------------------------------------------------------ */

/** No result for this address. Terminal — route to review for manual entry. */
export class GeocodeNotFound extends Error {
  readonly terminal = true;
  constructor(message: string) {
    super(message);
    this.name = "GeocodeNotFound";
  }
}

/** Network failure, 5xx, rate limit, timeout. Retrying may succeed. */
export class GeocodeTransient extends Error {
  readonly terminal = false;
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeocodeTransient";
  }
}

/** Bad key, API not enabled, quota exhausted. Our problem — this should alert. */
export class GeocodeConfigError extends Error {
  readonly terminal = true;
  constructor(message: string) {
    super(message);
    this.name = "GeocodeConfigError";
  }
}

/* ------------------------------------------------------------------ */

type AddressComponent = {
  short_name?: string;
  long_name?: string;
  types?: string[];
};

export type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    partial_match?: boolean;
    geometry?: {
      location?: { lat?: number; lng?: number };
      location_type?: string;
    };
    address_components?: AddressComponent[];
  }>;
};

export class GoogleGeocodeProvider implements GeocodeProvider {
  readonly name = "google_geocoding";

  constructor(
    private readonly apiKey: string,
    /**
     * Restricting to New Jersey keeps "123 Main St" from resolving to a Main
     * Street three states away. Every American Prime job is in NJ.
     */
    private readonly components = "country:US|administrative_area:NJ",
  ) {
    if (!apiKey) throw new GeocodeConfigError("GOOGLE_MAPS_API_KEY missing");
  }

  async geocode({ address }: GeocodeInput): Promise<GeocodeResult> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("address", address);
    url.searchParams.set("components", this.components);
    url.searchParams.set("key", this.apiKey);

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new GeocodeTransient(
        `Geocoding API unreachable: ${(err as Error).message}`,
      );
    }

    if (res.status === 429 || res.status >= 500) {
      throw new GeocodeTransient(`Geocoding API ${res.status}`, res.status);
    }
    if (!res.ok) {
      throw new GeocodeConfigError(
        `Geocoding API ${res.status}: ${await res.text().catch(() => "")}`,
      );
    }

    const body = (await res.json()) as GoogleGeocodeResponse;
    return normalizeGeocode(body, address);
  }
}

/**
 * Exported separately from the provider so fixtures can be normalized in tests
 * without standing up a fake HTTP layer.
 */
export function normalizeGeocode(
  body: GoogleGeocodeResponse,
  address: string,
): GeocodeResult {
  // Geocoding reports failure in the body with HTTP 200, so status handling
  // lives here rather than alongside the response-code checks above.
  const status = body.status ?? "UNKNOWN_ERROR";

  if (status === "ZERO_RESULTS") {
    throw new GeocodeNotFound(`No geocode result for "${address}"`);
  }
  if (status === "OVER_QUERY_LIMIT" || status === "UNKNOWN_ERROR") {
    throw new GeocodeTransient(`Geocoding API status ${status}`);
  }
  if (status !== "OK") {
    // REQUEST_DENIED, INVALID_REQUEST — bad key, API not enabled, malformed.
    throw new GeocodeConfigError(
      `Geocoding API status ${status}: ${body.error_message ?? ""}`,
    );
  }

  const r = body.results?.[0];
  const lat = r?.geometry?.location?.lat;
  const lng = r?.geometry?.location?.lng;

  if (!r || typeof lat !== "number" || typeof lng !== "number") {
    throw new GeocodeNotFound(`Geocode result for "${address}" had no location`);
  }

  return {
    formattedAddress: r.formatted_address ?? address,
    placeId: r.place_id ?? null,
    lat,
    lng,
    precision: normalizePrecision(r.geometry?.location_type),
    // Absent means false; Google only sets the key when it is true.
    partialMatch: r.partial_match === true,
    state: component(r.address_components, "administrative_area_level_1"),
    postalCode: component(r.address_components, "postal_code"),
    locality:
      component(r.address_components, "locality", "long") ??
      component(r.address_components, "sublocality", "long"),
    raw: body,
  };
}

function normalizePrecision(t: string | undefined): GeocodePrecision {
  // An unrecognised or missing location_type is treated as the loosest grade so
  // the gate routes it to a human rather than auto-approving on a guess. This
  // matches how `google-solar.ts` handles an unknown imageryQuality.
  return t === "ROOFTOP" ||
    t === "RANGE_INTERPOLATED" ||
    t === "GEOMETRIC_CENTER" ||
    t === "APPROXIMATE"
    ? t
    : "APPROXIMATE";
}

function component(
  components: AddressComponent[] | undefined,
  type: string,
  form: "short" | "long" = "short",
): string | null {
  const match = components?.find((c) => c.types?.includes(type));
  return (form === "long" ? match?.long_name : match?.short_name) ?? null;
}
