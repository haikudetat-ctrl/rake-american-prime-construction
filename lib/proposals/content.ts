import { createHash, randomBytes } from "node:crypto";

// What a homeowner sees on a proposal, and the fingerprint that proves which
// version they signed. Pure, for tests.

export type ProposalOption = {
  systemId: string;
  name: string;
  brand: string;
  tierLabel: string;
  warranty: string;
  priceCents: number;
  overrideCents?: number;
};
export type ProposalAddon = { addonId: string; name: string; qty: number; unitLabel: string; priceCents: number };

export type ProposalContent = {
  number: number;
  brandName: string;
  customerName: string;
  address: string | null;
  scope: string[];
  options: ProposalOption[];
  addons: ProposalAddon[];
  terms: string;
};

/** The price the homeowner sees for an option: the owner's price if set, else the calculated one. */
export const optionPrice = (o: Pick<ProposalOption, "priceCents" | "overrideCents">) => o.overrideCents ?? o.priceCents;

/** Plain-language scope from the measurements, for the proposal and the crew. */
export function scopeLines(m: Record<string, number>): string[] {
  const lines = [`Remove and replace about ${m.squares} squares of roofing (${m.pitch}/12 pitch)`];
  if (m.layers > 0) lines.push(`Tear off ${m.layers} existing layer${m.layers > 1 ? "s" : ""} down to the deck`);
  if (m.deck_sheets > 0) lines.push(`Replace up to ${m.deck_sheets} sheets of damaged decking`);
  lines.push("New underlayment, ice & water shield at eaves and valleys, starter, drip edge, ridge cap");
  if (m.pipe_boots > 0) lines.push(`${m.pipe_boots} new pipe boot${m.pipe_boots > 1 ? "s" : ""}`);
  if (m.ridges > 0) lines.push("Ridge ventilation");
  if (m.step_flashing > 0 || m.wall_flashing > 0) lines.push("New step and wall flashing where the roof meets walls");
  lines.push("Full cleanup and magnetic nail sweep; debris hauled away");
  return lines;
}

/** SHA-256 over a stable serialization of exactly what is shown. */
export function contentHash(c: ProposalContent): string {
  const stable = {
    number: c.number,
    brandName: c.brandName,
    customerName: c.customerName,
    address: c.address,
    scope: c.scope,
    options: c.options.map((o) => [o.systemId, o.name, o.brand, o.tierLabel, o.warranty, optionPrice(o)]),
    addons: c.addons.map((a) => [a.addonId, a.name, a.qty, a.unitLabel, a.priceCents]),
    terms: c.terms,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** Unguessable link token (256 bits). */
export const newProposalToken = () => randomBytes(32).toString("base64url");

/**
 * PLACEHOLDER contract terms. These must be replaced with Andrey's own terms,
 * reviewed by his attorney: New Jersey home improvement contracts have
 * required contents (including the contractor's registration number and a
 * three-day right to cancel), which this text only marks the place for.
 */
export const PLACEHOLDER_TERMS = `[PLACEHOLDER TERMS — replace with your own, reviewed by your attorney, before sending proposals.]

1. Scope. The work is described above. Anything not listed is not included.
2. Price and payment. [Deposit and payment schedule go here.]
3. Schedule. [Start and completion dates or how they are set go here.]
4. Hidden damage. [How rotten decking and other hidden conditions are handled and priced goes here.]
5. Warranty. Manufacturer warranty as described for the chosen system. [Workmanship warranty goes here.]
6. Permits and inspections. [Who obtains permits goes here.]
7. Contractor registration. [NJ Home Improvement Contractor registration number goes here.]
8. Insurance. [Liability insurer and policy details go here.]
9. Right to cancel. [The required notice of the right to cancel within three business days goes here.]`;

/** Shown above the signature: consent to sign electronically (ESIGN). */
export const ESIGN_CONSENT =
  "I agree to sign this proposal electronically and to receive it and related records electronically. My typed name and drawn signature have the same effect as a handwritten signature. I can download a copy after signing, and I can ask for a paper copy at any time.";
