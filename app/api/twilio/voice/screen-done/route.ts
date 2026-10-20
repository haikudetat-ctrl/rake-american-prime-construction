import { emptyTwiml, hangupTwiml } from "@/lib/phone/twiml";
import { readTwilioRequest, twiml } from "@/lib/phone/server";

export const runtime = "nodejs";

/** 1 connects the caller (an empty response ends the screen); anything else drops this phone only. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  return twiml(read.params.Digits === "1" ? emptyTwiml() : hangupTwiml());
}
