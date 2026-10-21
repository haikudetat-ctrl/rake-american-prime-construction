/**
 * Address search for the public request forms, through Places API (New).
 *
 * The browser never talks to Google: it calls our /api/places routes, which
 * call these with the server key. That keeps the key off the page and keeps
 * the dropdown in our own markup instead of Google's widget.
 *
 * Billing (per Google's Places API (New) pricing, Oct 2026):
 * - Autocomplete calls that carry a session token and end in a Place Details
 *   call with the same token are not charged; the Details call is.
 * - Place Details with only id / formattedAddress / location /
 *   addressComponents is the Essentials SKU ($5 per 1,000, 10,000 free a month).
 * An abandoned search (typed, never picked) is billed per autocomplete call.
 */

const AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_ENDPOINT = "https://places.googleapis.com/v1/places/";
const TIMEOUT_MS = 6_000;

/**
 * Every American Prime job is in New Jersey (see lib/integrations/geocode.ts).
 * A rectangle can't follow a state line, so this also admits Philadelphia,
 * Staten Island and northern Delaware; that's acceptable for a search box.
 */
export const NJ_RECTANGLE = {
  low: { latitude: 38.92, longitude: -75.57 },
  high: { latitude: 41.36, longitude: -73.88 },
};

/** Street addresses and buildings only: no businesses, towns or bare streets. */
const ADDRESS_TYPES = ["street_address", "premise", "subpremise"];

export type AddressSuggestion = {
  placeId: string;
  /** "12 Ocean Ave" */
  main: string;
  /** "Ventnor City, NJ, USA" */
  secondary: string;
  /** Both parts together, for the input once picked. */
  text: string;
};

export type PlaceAddress = {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  /** Town, for grouping a driver's run. */
  locality: string | null;
  postalCode: string | null;
  state: string | null;
};

/** Google's place IDs are URL-safe base64-ish strings. Anything else is junk. */
export function isPlaceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,300}$/.test(value);
}

export class PlacesError extends Error {
  constructor(
    message: string,
    /** HTTP status from Google, when there was one. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlacesError";
  }
}

async function call(url: string, init: RequestInit, apiKey: string, fieldMask: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new PlacesError(`Places API unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) {
    // 403 here usually means "Places API (New)" isn't enabled on the key, or
    // the key's API restrictions don't include it.
    const body = await res.text().catch(() => "");
    throw new PlacesError(`Places API ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return res.json();
}

export async function autocompleteAddresses(
  apiKey: string,
  input: string,
  sessionToken: string,
): Promise<AddressSuggestion[]> {
  const body = await call(
    AUTOCOMPLETE_ENDPOINT,
    {
      method: "POST",
      body: JSON.stringify({
        input,
        sessionToken,
        includedPrimaryTypes: ADDRESS_TYPES,
        includedRegionCodes: ["us"],
        locationRestriction: { rectangle: NJ_RECTANGLE },
        languageCode: "en",
      }),
    },
    apiKey,
    "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat",
  );
  return normalizeSuggestions(body as AutocompleteResponse);
}

export async function placeAddress(apiKey: string, placeId: string, sessionToken?: string): Promise<PlaceAddress> {
  if (!isPlaceId(placeId)) throw new PlacesError("Not a place ID");
  const url = new URL(DETAILS_ENDPOINT + encodeURIComponent(placeId));
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
  const body = await call(url.toString(), { method: "GET" }, apiKey, "id,formattedAddress,location,addressComponents");
  return normalizePlace(body as DetailsResponse);
}

/* ------------------------------------------------------------------ */
/* Response shapes and normalizers, exported for tests                 */
/* ------------------------------------------------------------------ */

export type AutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }>;
};

export type DetailsResponse = {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
};

export function normalizeSuggestions(body: AutocompleteResponse): AddressSuggestion[] {
  const out: AddressSuggestion[] = [];
  for (const s of body.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const text = p.text?.text ?? "";
    const main = p.structuredFormat?.mainText?.text ?? text;
    const secondary = p.structuredFormat?.secondaryText?.text ?? "";
    if (!main) continue;
    out.push({ placeId: p.placeId, main, secondary, text: text || [main, secondary].filter(Boolean).join(", ") });
  }
  return out;
}

export function normalizePlace(body: DetailsResponse): PlaceAddress {
  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  if (!body.id || !body.formattedAddress || typeof lat !== "number" || typeof lng !== "number") {
    throw new PlacesError("Place details missing address or location");
  }
  const part = (type: string, form: "long" | "short" = "short") => {
    const c = body.addressComponents?.find((x) => x.types?.includes(type));
    return (form === "long" ? c?.longText : c?.shortText) ?? null;
  };
  return {
    placeId: body.id,
    formattedAddress: body.formattedAddress,
    lat,
    lng,
    locality: part("locality", "long") ?? part("sublocality", "long") ?? part("postal_town", "long"),
    postalCode: part("postal_code"),
    state: part("administrative_area_level_1"),
  };
}

/** "12 Ocean Ave, Ventnor City, NJ 08406, USA" → without the country, for display. */
export function displayAddress(formatted: string): string {
  return formatted.replace(/,\s*USA$/, "");
}
