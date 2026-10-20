import { describe, expect, it } from "vitest";
import { proposalLinkSms, proposalSignedEmail, proposalSignedSms } from "@/lib/outbox/messages";
import { renderProposalPdf } from "@/lib/pdf/render";
import { contentHash, newProposalToken, optionPrice, PLACEHOLDER_TERMS, scopeLines, type ProposalContent } from "@/lib/proposals/content";

const content: ProposalContent = {
  number: 1001,
  brandName: "American Prime Construction",
  customerName: "Pat Homeowner",
  address: "12 Ocean Ave, Ventnor, NJ",
  scope: scopeLines({ squares: 30, pitch: 8, layers: 1, deck_sheets: 4, pipe_boots: 3, ridges: 40, step_flashing: 16, wall_flashing: 0 }),
  options: [
    { systemId: "good", name: "GAF Timberline HDZ", brand: "GAF", tierLabel: "Good", warranty: "Ltd. lifetime", priceCents: 1500000 },
    { systemId: "best", name: "GAF Grand Sequoia", brand: "GAF", tierLabel: "Best", warranty: "", priceCents: 2100000, overrideCents: 2000000 },
  ],
  addons: [{ addonId: "gutters", name: "Seamless gutters", qty: 150, unitLabel: "ft", priceCents: 118000 }],
  terms: PLACEHOLDER_TERMS,
};

describe("proposal content", () => {
  it("shows the owner's price when one is set", () => {
    expect(optionPrice(content.options[0])).toBe(1500000);
    expect(optionPrice(content.options[1])).toBe(2000000);
  });

  it("describes the scope from the measurements", () => {
    expect(content.scope[0]).toBe("Remove and replace about 30 squares of roofing (8/12 pitch)");
    expect(content.scope).toContain("Replace up to 4 sheets of damaged decking");
    expect(content.scope).toContain("3 new pipe boots");
  });

  it("fingerprints exactly what the homeowner sees", () => {
    const hash = contentHash(content);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ ...content })).toBe(hash);
    expect(contentHash({ ...content, terms: content.terms + " " })).not.toBe(hash);
    const cheaper = { ...content, options: [{ ...content.options[0], overrideCents: 1400000 }, content.options[1]] };
    expect(contentHash(cheaper)).not.toBe(hash);
  });

  it("makes long, unguessable link tokens", () => {
    const a = newProposalToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newProposalToken()).not.toBe(a);
  });
});

describe("proposal messages", () => {
  const brand = { name: "American Prime Construction", phone: "+16095550000" };
  it("texts the homeowner their link", () => {
    expect(proposalLinkSms({ name: "Pat Homeowner", link: "https://app/p/abc" }, brand))
      .toBe("American Prime Construction: hi Pat, your roofing proposal is ready. Review the options and sign here: https://app/p/abc Reply STOP to opt out.");
  });
  it("confirms the signed agreement", () => {
    const email = proposalSignedEmail({ name: "Pat Homeowner", number: 1001, option: "GAF Grand Sequoia", totalCents: 2118000 }, brand);
    expect(email.subject).toBe("Signed: roofing agreement #1001 with American Prime Construction");
    expect(email.text).toContain("You signed for GAF Grand Sequoia, total $21,180.00.");
    expect(proposalSignedSms({ name: "Pat", option: "GAF Grand Sequoia", totalCents: 2118000, leadId: "L1" }, "https://app"))
      .toBe("Signed! Pat: GAF Grand Sequoia, $21,180.00. https://app/office/leads/L1");
  });
});

describe("proposal PDF", () => {
  // 1×1 transparent PNG
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  it("renders the proposal and the signed agreement", async () => {
    const brand = { name: "American Prime Construction", phone: null, email: null, address: null };
    const draft = await renderProposalPdf({ content, brand, sentAt: null, satellite: null, signed: null });
    expect(draft.subarray(0, 5).toString()).toBe("%PDF-");
    const signed = await renderProposalPdf({
      content, brand, sentAt: "2026-10-20T15:00:00Z", satellite: null,
      signed: {
        option: content.options[1], addons: content.addons, totalCents: 2118000, signerName: "Pat Homeowner",
        signatureDataUrl: png, signedAt: "2026-10-21T15:00:00Z", ip: "1.2.3.4", userAgent: "Test", contentHash: contentHash(content),
      },
    });
    expect(signed.subarray(0, 5).toString()).toBe("%PDF-");
    expect(signed.length).toBeGreaterThan(draft.length / 2);
  }, 30_000);
});
