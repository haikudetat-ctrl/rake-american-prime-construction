import "server-only";
import { GoogleGeocodeProvider } from "@/lib/integrations/geocode";

/**
 * Satellite photo of a house for the proposal cover (Google Maps Static API,
 * same key as geocoding; the "Maps Static API" must be enabled on it). Fetched
 * on the server so the key never reaches the page. Null when unavailable.
 */
export async function satelliteImage(p: { lat: number | null; lng: number | null; address: string | null }): Promise<Buffer | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  let { lat, lng } = p;
  if ((lat === null || lng === null) && p.address) {
    try {
      const place = await new GoogleGeocodeProvider(key).geocode({ address: p.address });
      if (place) ({ lat, lng } = place);
    } catch {
      return null;
    }
  }
  if (lat === null || lng === null) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.search = new URLSearchParams({
    center: `${lat},${lng}`, zoom: "20", size: "640x360", scale: "2", maptype: "satellite", key,
  }).toString();
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
  return Buffer.from(await res.arrayBuffer());
}
