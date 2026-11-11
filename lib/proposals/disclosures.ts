/**
 * What a New Jersey home improvement contract has to say beyond the owner's
 * own terms (N.J.S.A. 56:8-151, N.J.A.C. 13:45A-16.2 and 17.11-17.13), built
 * from settings so it can't be edited away or forgotten. It is appended to the
 * terms when a proposal is sent, so it is frozen with the proposal and covered
 * by its fingerprint like everything else the homeowner signs.
 *
 * Not legal advice: the wording of the notice follows the Division of Consumer
 * Affairs' own text; the owner's attorney should review the whole contract once.
 */

/** The Division of Consumer Affairs' toll-free number, which contracts must show (N.J.A.C. 13:45A-17.11(e)). */
export const NJ_CONSUMER_AFFAIRS_PHONE = "1-888-656-6225";

/** Marks where the notice starts inside frozen terms, so pages can set it in bold. */
export const NOTICE_HEADING = "NOTICE TO CONSUMER";

export type ContractorFacts = {
  legalName: string | null;
  address: string | null;
  phone: string | null;
  hicNumber: string | null;
  insurerName: string | null;
  insurerPhone: string | null;
  startWithinDays: number | null;
  finishWithinDays: number | null;
  salesRep: string | null;
};

/** What is still missing before a proposal can go to a New Jersey homeowner, in plain words. */
export function missingNjFacts(f: ContractorFacts): string[] {
  const missing: string[] = [];
  if (!f.legalName?.trim()) missing.push("the company's legal name");
  if (!f.address?.trim()) missing.push("the business address");
  if (!f.phone?.trim()) missing.push("the business phone");
  if (!f.hicNumber?.trim()) missing.push("the NJ HIC registration number");
  if (!f.insurerName?.trim()) missing.push("the liability insurer");
  if (!f.insurerPhone?.trim()) missing.push("the insurer's phone number");
  if (!f.startWithinDays) missing.push("when work starts after signing");
  if (!f.finishWithinDays) missing.push("how long the work takes");
  return missing;
}

/** The statutory three-day cancellation notice, filled in with the contractor. */
export function cancellationNotice(f: Pick<ContractorFacts, "legalName" | "address" | "phone">): string {
  return [
    NOTICE_HEADING,
    "YOU MAY CANCEL THIS CONTRACT AT ANY TIME BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT. IF YOU WISH TO CANCEL THIS CONTRACT, YOU MUST EITHER:",
    "1. SEND A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION BY REGISTERED OR CERTIFIED MAIL, RETURN RECEIPT REQUESTED; OR",
    "2. PERSONALLY DELIVER A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION TO:",
    [f.legalName, f.address, f.phone].filter(Boolean).join(", "),
    "If you cancel this contract within the three-day period, you are entitled to a full refund of your money. Refunds must be made within 30 days of the contractor's receipt of the cancellation notice.",
  ].join("\n");
}

/** The required facts, then the notice, as one block for the end of the terms. */
export function njDisclosures(f: ContractorFacts): string {
  const lines = [
    "CONTRACTOR INFORMATION",
    `Contractor: ${f.legalName}, ${f.address}, ${f.phone}. New Jersey Home Improvement Contractor registration #${f.hicNumber}.`,
    f.salesRep ? `Sales representative: ${f.salesRep}, at the business address above.` : null,
    `Insurance: the contractor carries commercial general liability insurance of at least $500,000 per occurrence, issued by ${f.insurerName} (${f.insurerPhone}). A copy of the certificate of insurance is provided with this contract.`,
    `Schedule: work is expected to start within ${f.startWithinDays} days of signing and to be completed within ${f.finishWithinDays} working days of starting, weather permitting.`,
    `Questions or complaints about home improvement contractors: New Jersey Division of Consumer Affairs, ${NJ_CONSUMER_AFFAIRS_PHONE}.`,
  ].filter((l): l is string => l !== null);
  return `${lines.join("\n")}\n\n${cancellationNotice(f)}`;
}

/** The owner's terms with the required block appended (what a proposal is sent with). */
export function composeTerms(ownerTerms: string, f: ContractorFacts): string {
  return `${ownerTerms.trim()}\n\n${njDisclosures(f)}`;
}

/** Splits frozen terms so the notice can be set apart in bold; older proposals have none. */
export function splitNotice(terms: string): { body: string; notice: string | null } {
  const at = terms.lastIndexOf(`\n${NOTICE_HEADING}\n`);
  if (at < 0) return { body: terms, notice: null };
  return { body: terms.slice(0, at).trimEnd(), notice: terms.slice(at + 1) };
}
