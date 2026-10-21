import { NextResponse } from "next/server";
import { displayAddress, placeAddress } from "@/lib/integrations/places";
import { clientIp, detailsBody, overLimit, tokenIsLive } from "@/lib/intake/places-api";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The full address (with ZIP) for a picked suggestion, so the person sees
 * exactly what we'll store before they send. Closes the Google billing
 * session the search opened. The form submit looks the place up again on the
 * server; nothing returned here is trusted later.
 */
export async function POST(req: Request) {
  const parsed = detailsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !tokenIsLive(parsed.data.token)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (overLimit(clientIp(req))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });

  try {
    const place = await placeAddress(key, parsed.data.placeId, parsed.data.session);
    return NextResponse.json(
      { placeId: place.placeId, address: displayAddress(place.formattedAddress), zip: place.postalCode },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[places/details]", (err as Error).message);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
