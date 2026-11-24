/**
 * Facts the Privacy Policy and Terms rely on that only the business can
 * supply. Each one still in [BRACKETS] is unconfirmed: fill it in (from
 * Andre) before this ships. `unfilledLegalFields()` lists what is left.
 *
 * The legal name, notice address and contact email are not here: they come
 * from Settings (the legal name proposals print, the roofing brand's address
 * and email), so one edit there fixes proposals and these pages together.
 * `legalIdentity()` fills in a visible placeholder for any that are blank.
 *
 * This is a draft prepared for review, not legal advice. Have a New Jersey
 * attorney read both pages before relying on them.
 */
export const LEGAL = {
  /** The number customers get texts from (the business's own Twilio number once A2P is approved). */
  textingNumber: "[BUSINESS TEXTING NUMBER]",
  /** How long a request that never became a job is kept before it is deleted. */
  unconvertedLeadRetention: "[e.g. 24 months]",
  /** Date the current versions take effect. Change it whenever either page changes in substance. */
  effectiveDate: "[EFFECTIVE DATE]",
} as const;

export function unfilledLegalFields(): string[] {
  return Object.entries(LEGAL)
    .filter(([, value]) => /^\[.*\]$/.test(value))
    .map(([key]) => key);
}

/** Who the legal pages name, from Settings, with a visible placeholder for anything not filled in yet. */
export function legalIdentity(content: {
  legal: { name: string | null; address: string | null };
  contacts: { roofing: { email: string | null } };
}): { name: string; address: string; email: string | null } {
  return {
    name: content.legal.name ?? "[LEGAL ENTITY NAME: Settings, proposal legal name]",
    address: content.legal.address ?? "[MAILING ADDRESS: Settings, roofing business address]",
    email: content.contacts.roofing.email,
  };
}
