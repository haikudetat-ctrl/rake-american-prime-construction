import { describe, expect, it } from "vitest";
import { contentHash, type ProposalContent } from "@/lib/proposals/content";
import { composeTerms, missingNjFacts, NJ_CONSUMER_AFFAIRS_PHONE, splitNotice, type ContractorFacts } from "@/lib/proposals/disclosures";

const facts: ContractorFacts = {
  legalName: "Example Roofing LLC",
  address: "1 Example Road, Trenton, NJ 08600",
  phone: "(609) 555-0100",
  hicNumber: "13VH00000000",
  insurerName: "Example Mutual",
  insurerPhone: "(800) 555-0199",
  startWithinDays: 30,
  finishWithinDays: 3,
  salesRep: "Avery Example",
};

describe("NJ contract disclosures", () => {
  it("lists what is missing in plain words", () => {
    expect(missingNjFacts(facts)).toEqual([]);
    expect(missingNjFacts({ ...facts, insurerPhone: " ", startWithinDays: null })).toEqual([
      "the insurer's phone number",
      "when work starts after signing",
    ]);
  });

  it("appends the required facts and the three-day notice to the owner's terms", () => {
    const terms = composeTerms("1. Scope. As described above.", facts);
    expect(terms.startsWith("1. Scope. As described above.\n\nCONTRACTOR INFORMATION")).toBe(true);
    expect(terms).toContain("registration #13VH00000000");
    expect(terms).toContain("issued by Example Mutual ((800) 555-0199)");
    expect(terms).toContain("start within 30 days of signing and to be completed within 3 working days");
    expect(terms).toContain(NJ_CONSUMER_AFFAIRS_PHONE);
    expect(terms).toContain("Sales representative: Avery Example");
    expect(terms).toContain("BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT");
    expect(terms).toContain("Example Roofing LLC, 1 Example Road, Trenton, NJ 08600, (609) 555-0100");
  });

  it("splits the notice out so it can be set in bold", () => {
    const { body, notice } = splitNotice(composeTerms("Owner terms.", facts));
    expect(body.endsWith("Division of Consumer Affairs, 1-888-656-6225.")).toBe(true);
    expect(notice?.startsWith("NOTICE TO CONSUMER\nYOU MAY CANCEL")).toBe(true);
    expect(notice).toContain("within 30 days of the contractor's receipt");
  });

  it("leaves older proposals without a notice as they were", () => {
    expect(splitNotice("Old terms only.")).toEqual({ body: "Old terms only.", notice: null });
  });

  it("is part of what the homeowner signs: the fingerprint covers it", () => {
    const base: ProposalContent = {
      number: 1, brandName: "Example", customerName: "Pat", address: null, scope: [], options: [], addons: [], terms: "Owner terms.",
    };
    expect(contentHash({ ...base, terms: composeTerms(base.terms, facts) })).not.toBe(contentHash(base));
  });
});
