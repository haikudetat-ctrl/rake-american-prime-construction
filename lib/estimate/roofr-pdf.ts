import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

const MAX_BYTES = 25 * 1024 * 1024;

/** Text of a PDF, or null if it isn't a readable PDF. */
export async function pdfText(bytes: Uint8Array): Promise<string | null> {
  const isPdf = bytes.length > 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (!isPdf || bytes.length > MAX_BYTES) return null;
  try {
    const doc = await getDocumentProxy(bytes);
    try {
      const { text } = await extractText(doc, { mergePages: true });
      return typeof text === "string" && text.trim() ? text : null;
    } finally {
      await doc.cleanup().catch(() => undefined);
    }
  } catch {
    return null;
  }
}
