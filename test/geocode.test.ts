import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeocodeNotFound,
  GoogleGeocodeProvider,
  normalizeGeocode,
  type GoogleGeocodeResponse,
} from "@/lib/integrations/geocode";
import { SERVICE_RECTANGLE } from "@/lib/integrations/places";

type Part = { long_name: string; short_name: string; types: string[] };
const part = (long_name: string, short_name: string, ...types: string[]): Part => ({ long_name, short_name, types });

function response(formatted: string, parts: Part[], extra: { location_type?: string; partial_match?: boolean } = {}): GoogleGeocodeResponse {
  return {
    status: "OK",
    results: [
      {
        formatted_address: formatted,
        place_id: "pid",
        partial_match: extra.partial_match,
        geometry: { location: { lat: 40.13, lng: -75.51 }, location_type: extra.location_type ?? "ROOFTOP" },
        address_components: parts,
      },
    ],
  };
}

const phoenixville = response("109 Center Ave, Phoenixville, PA 19460, USA", [
  part("109", "109", "street_number"),
  part("Center Avenue", "Center Ave", "route"),
  part("Phoenixville", "Phoenixville", "locality", "political"),
  part("Pennsylvania", "PA", "administrative_area_level_1", "political"),
  part("19460", "19460", "postal_code"),
]);

describe("geocoding outside New Jersey (Nov 23)", () => {
  it("takes a Pennsylvania street address as it is", () => {
    const g = normalizeGeocode(phoenixville, "109 Center Ave, Phoenixville, PA");
    expect(g.formattedAddress).toBe("109 Center Ave, Phoenixville, PA 19460, USA");
    expect(g.state).toBe("PA");
    expect(g.locality).toBe("Phoenixville");
  });

  it("refuses Google's fall-back to the whole state, so the typed address is kept", () => {
    const state = response(
      "New Jersey, USA",
      [part("New Jersey", "NJ", "administrative_area_level_1", "political"), part("United States", "US", "country", "political")],
      { location_type: "APPROXIMATE", partial_match: true },
    );
    expect(() => normalizeGeocode(state, "109 Center Ave, Phoenixville, PA")).toThrow(GeocodeNotFound);
  });

  it("refuses a town or ZIP with no street", () => {
    const town = response("Phoenixville, PA 19460, USA", [
      part("Phoenixville", "Phoenixville", "locality", "political"),
      part("Pennsylvania", "PA", "administrative_area_level_1", "political"),
      part("19460", "19460", "postal_code"),
    ]);
    expect(() => normalizeGeocode(town, "Center Ave, Phoenixville")).toThrow(/not a street address/);
  });

  it("refuses a street in a state American Prime doesn't work in", () => {
    const ohio = response("12 Main St, Columbus, OH 43215, USA", [
      part("12", "12", "street_number"),
      part("Main Street", "Main St", "route"),
      part("Ohio", "OH", "administrative_area_level_1", "political"),
    ]);
    expect(() => normalizeGeocode(ohio, "12 Main St")).toThrow(/outside the service area/);
  });
});

describe("what the lookup asks Google", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("no longer locks to New Jersey; it prefers the service area instead", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(phoenixville), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new GoogleGeocodeProvider("key").geocode({ address: "109 Center Ave, Phoenixville, PA" });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("components")).toBe("country:US");
    expect(url.searchParams.get("bounds")).toBe("38.92,-76.4|41.36,-73.88");
  });

  it("keeps the ZIP filter for typed addresses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(phoenixville), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new GoogleGeocodeProvider("key").geocode({ address: "109 Center Ave", postalCode: "19460" });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("components")).toBe("country:US|postal_code:19460");
  });
});

describe("public form address search", () => {
  it("reaches the Pennsylvania suburbs and stays east of Harrisburg", () => {
    const inBox = (lat: number, lng: number) =>
      lat >= SERVICE_RECTANGLE.low.latitude && lat <= SERVICE_RECTANGLE.high.latitude &&
      lng >= SERVICE_RECTANGLE.low.longitude && lng <= SERVICE_RECTANGLE.high.longitude;
    expect(inBox(40.13, -75.51)).toBe(true); // Phoenixville
    expect(inBox(40.34, -75.93)).toBe(true); // Reading
    expect(inBox(40.6, -75.47)).toBe(true); // Allentown
    expect(inBox(40.22, -74.76)).toBe(true); // Trenton
    expect(inBox(40.27, -76.88)).toBe(false); // Harrisburg
  });
});
