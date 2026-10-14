/**
 * Normalizes a US phone number to E.164 (+1XXXXXXXXXX). Returns null if the
 * input is not a plausible 10-digit US number, so a typo is caught at the
 * form rather than when the confirmation text bounces.
 */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;
  return `+1${national}`;
}

export function formatPhone(e164: string | null | undefined): string {
  const m = e164?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}
