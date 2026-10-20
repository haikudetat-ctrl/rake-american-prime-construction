import { hangupTwiml } from "@/lib/phone/twiml";
import { readTwilioRequest, twiml } from "@/lib/phone/server";

export const runtime = "nodejs";

/** After the caller finishes recording. The recording itself arrives at /recording. */
export async function POST(req: Request) {
  const read = await readTwilioRequest(req);
  if ("denied" in read) return read.denied;
  return twiml(hangupTwiml());
}
