const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** All money is stored as integer cents; this is the only place it becomes text. */
export function formatCents(cents: number | null | undefined): string {
  return usd.format((cents ?? 0) / 100);
}

/** Parses "350", "350.5" or "$1,234.56" into cents. Returns null for anything else. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
