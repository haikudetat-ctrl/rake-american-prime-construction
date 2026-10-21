import { describe, expect, it } from "vitest";
import { handTypedAddress, isConfident } from "@/lib/intake/address";
import { rentalRequestSchema } from "@/lib/intake/schema";
import type { GeocodeResult } from "@/lib/integrations/geocode";
import { displayAddress, isPlaceId, normalizePlace, normalizeSuggestions } from "@/lib/integrations/places";
import { leadRequestSchema } from "@/lib/leads/schema";

const request = {
  contactName: "Pat Roofer",
  phone: "(609) 555-0123",
  requestedDate: "2026-10-22",
  formToken: "1700000000000.sig",
};

describe("address on the public forms", () => {
  it("accepts a picked address without town or ZIP", () => {
    const parsed = rentalRequestSchema.parse({ ...request, placeId: "ChIJ12OceanAveVentnor", address: "12 Ocean Ave, Ventnor City, NJ" });
    expect(parsed.placeId).toBe("ChIJ12OceanAveVentnor");
    expect(parsed.zip).toBeUndefined();
  });

  it("needs town and ZIP when the address is typed by hand", () => {
    const result = rentalRequestSchema.safeParse({ ...request, placeId: "", address: "12 Ocean Ave" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(["town", "zip"]);
  });

  it("takes a typed address with town and ZIP, trimming ZIP+4", () => {
    const parsed = rentalRequestSchema.parse({ ...request, address: "12 Ocean Ave", town: "Ventnor City", zip: "08406-1234" });
    expect(parsed.zip).toBe("08406");
    expect(parsed.placeId).toBeUndefined();
  });

  it("rejects a malformed ZIP", () => {
    expect(rentalRequestSchema.safeParse({ ...request, address: "12 Ocean Ave", town: "Ventnor", zip: "8406" }).success).toBe(false);
  });

  it("treats a junk place ID as typed, so it still needs a ZIP", () => {
    const result = leadRequestSchema.safeParse({ name: "Pat", phone: "609 555 0100", formToken: "t", placeId: "../../etc", address: "12 Ocean Ave" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toContain("zip");
  });

  it("combines a typed address for storage", () => {
    expect(handTypedAddress({ address: "12 Ocean Ave", town: "Ventnor City", zip: "08406" })).toBe("12 Ocean Ave, Ventnor City 08406");
  });
});

describe("geocoding a typed address", () => {
  const hit: GeocodeResult = {
    formattedAddress: "12 Ocean Ave, Ventnor City, NJ 08406, USA",
    placeId: "x",
    lat: 39.34,
    lng: -74.47,
    precision: "ROOFTOP",
    partialMatch: false,
    state: "NJ",
    postalCode: "08406",
    locality: "Ventnor City",
    raw: null,
  };

  it("pins a confident match inside the ZIP", () => {
    expect(isConfident(hit, "08406")).toBe(true);
  });

  it("won't pin Google's fall-back to the ZIP centre, or another ZIP", () => {
    expect(isConfident({ ...hit, partialMatch: true }, "08406")).toBe(false);
    expect(isConfident({ ...hit, precision: "APPROXIMATE" }, "08406")).toBe(false);
    expect(isConfident({ ...hit, postalCode: "08402" }, "08406")).toBe(false);
  });
});

describe("Places API responses", () => {
  it("keeps predictions with a place ID and splits street from town", () => {
    const out = normalizeSuggestions({
      suggestions: [
        {
          placePrediction: {
            placeId: "ChIJabc123def456",
            text: { text: "12 Ocean Ave, Ventnor City, NJ, USA" },
            structuredFormat: { mainText: { text: "12 Ocean Ave" }, secondaryText: { text: "Ventnor City, NJ, USA" } },
          },
        },
        { placePrediction: { text: { text: "no id" } } },
        {},
      ],
    });
    expect(out).toEqual([
      { placeId: "ChIJabc123def456", main: "12 Ocean Ave", secondary: "Ventnor City, NJ, USA", text: "12 Ocean Ave, Ventnor City, NJ, USA" },
    ]);
    expect(normalizeSuggestions({})).toEqual([]);
  });

  it("reads town, ZIP and location from place details", () => {
    const place = normalizePlace({
      id: "ChIJabc123def456",
      formattedAddress: "12 Ocean Ave, Ventnor City, NJ 08406, USA",
      location: { latitude: 39.34, longitude: -74.47 },
      addressComponents: [
        { longText: "Ventnor City", shortText: "Ventnor City", types: ["locality", "political"] },
        { longText: "New Jersey", shortText: "NJ", types: ["administrative_area_level_1", "political"] },
        { longText: "08406", shortText: "08406", types: ["postal_code"] },
      ],
    });
    expect(place).toMatchObject({ locality: "Ventnor City", postalCode: "08406", state: "NJ", lat: 39.34 });
    expect(displayAddress(place.formattedAddress)).toBe("12 Ocean Ave, Ventnor City, NJ 08406");
  });

  it("refuses details with no location", () => {
    expect(() => normalizePlace({ id: "ChIJabc123def456", formattedAddress: "x" })).toThrow();
  });

  it("only passes real-looking place IDs into the URL", () => {
    expect(isPlaceId("ChIJabc123def456")).toBe(true);
    expect(isPlaceId("../places")).toBe(false);
    expect(isPlaceId("short")).toBe(false);
  });
});
