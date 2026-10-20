import "server-only";
import { satelliteImage } from "@/lib/geo/satellite";
import { renderProposalPdf } from "@/lib/pdf/render";
import { signatureDataUrl, type FullProposal } from "@/lib/proposals/server";

/** The proposal (or signed agreement, once signed) as a PDF. */
export async function proposalPdf(p: FullProposal): Promise<Buffer> {
  const satellite = await satelliteImage(p.lead).catch(() => null);
  return renderProposalPdf({
    content: p.content,
    brand: p.brand,
    sentAt: p.sentAt,
    satellite,
    signed: p.signature
      ? {
          option: p.signature.option,
          addons: p.signature.addons,
          totalCents: p.signature.totalCents,
          signerName: p.signature.signerName,
          signatureDataUrl: await signatureDataUrl(p.signature.signaturePath),
          signedAt: p.signature.signedAt,
          ip: p.signature.ip,
          userAgent: p.signature.userAgent,
          contentHash: p.signature.contentHash,
        }
      : null,
  });
}
