import { NextResponse } from "next/server";
import { autocompleteAddresses } from "@/lib/integrations/places";
import { clientIp, overLimit, searchBody, tokenIsLive } from "@/lib/intake/places-api";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Address suggestions for the public request forms.
 *
 * 503 means "search isn't available": the form switches to typing the address
 * by hand with a ZIP, so a Google outage or a missing key never blocks a booking.
 */
export async function POST(req: Request) {
  const parsed = searchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !tokenIsLive(parsed.data.token)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (overLimit(clientIp(req))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });

  try {
    const suggestions = await autocompleteAddresses(key, parsed.data.q, parsed.data.session);
    return NextResponse.json({ suggestions }, { headers: NO_STORE });
  } catch (err) {
    console.error("[places/search]", (err as Error).message);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
