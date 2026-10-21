import "server-only";
import { GoogleGeocodeProvider, type GeocodeResult } from "@/lib/integrations/geocode";
import { placeAddress } from "@/lib/integrations/places";
import type { AddressInput } from "@/lib/intake/schema";

export type ResolvedAddress = {
  address: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
};

export async function geocode(address: string, postalCode?: string): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    return await new GoogleGeocodeProvider(key).geocode({ address, postalCode });
  } catch {
    // An address Google can't place still books; the office sees it as typed.
    return null;
  }
}

/**
 * Turns what the public form sent into the address we store.
 *
 * Picked from the dropdown: look the place up by ID. The form's text and the
 * ID both come from the browser, so neither is stored as sent.
 *
 * Typed by hand: geocode inside the ZIP they gave. Coordinates are kept only
 * for a confident match; otherwise the address is stored as typed with no
 * pin, and the office sees "(not found on map)" when approving.
 */
export async function resolveAddress(input: AddressInput): Promise<ResolvedAddress> {
  const key = process.env.GOOGLE_MAPS_API_KEY;

  if (input.placeId) {
    if (key) {
      try {
        const place = await placeAddress(key, input.placeId);
        return {
          address: place.formattedAddress,
          area: place.locality,
          lat: place.lat,
          lng: place.lng,
          placeId: place.placeId,
        };
      } catch {
        // Fall through: the picked text names street, town and state, so the
        // geocoder does about as well as it did before the dropdown.
      }
    }
    const g = await geocode(input.address);
    return g
      ? { address: g.formattedAddress, area: g.locality, lat: g.lat, lng: g.lng, placeId: g.placeId }
      : { address: input.address, area: null, lat: null, lng: null, placeId: null };
  }

  const typed = handTypedAddress(input);
  const g = await geocode(typed, input.zip);
  if (g && isConfident(g, input.zip)) {
    return { address: g.formattedAddress, area: g.locality ?? input.town ?? null, lat: g.lat, lng: g.lng, placeId: g.placeId };
  }
  return { address: typed, area: input.town ?? null, lat: null, lng: null, placeId: null };
}

export function handTypedAddress(input: AddressInput): string {
  return [input.address, [input.town, input.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/**
 * A partial match inside a ZIP filter is Google giving up and returning the
 * ZIP itself; pinning the can there would send the driver to the wrong street.
 */
export function isConfident(g: GeocodeResult, zip: string | undefined): boolean {
  if (g.partialMatch || g.precision === "APPROXIMATE") return false;
  return !zip || !g.postalCode || g.postalCode === zip;
}
