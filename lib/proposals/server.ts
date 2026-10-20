import "server-only";
import { contentHash, optionPrice, PLACEHOLDER_TERMS, scopeLines, type ProposalAddon, type ProposalContent, type ProposalOption } from "@/lib/proposals/content";
import { adminClient } from "@/lib/supabase/admin";

export type ProposalSettings = { terms: string; validDays: number; hicNumber: string | null; placeholder: boolean };

export async function loadProposalSettings(companyId: string): Promise<ProposalSettings> {
  const { data } = await adminClient().from("proposal_settings").select("*").eq("company_id", companyId).maybeSingle();
  if (!data) return { terms: PLACEHOLDER_TERMS, validDays: 30, hicNumber: null, placeholder: true };
  return { terms: data.terms, validDays: data.valid_days, hicNumber: data.hic_number, placeholder: data.terms.includes("[PLACEHOLDER") };
}

export type Brand = { name: string; phone: string | null; email: string | null; address: string | null };

async function roofingBrand(companyId: string): Promise<Brand> {
  const { data } = await adminClient()
    .from("brands")
    .select("display_name, phone, email, address")
    .eq("company_id", companyId)
    .eq("kind", "roofing")
    .single();
  return { name: data?.display_name ?? "American Prime Construction", phone: data?.phone ?? null, email: data?.email ?? null, address: data?.address ?? null };
}

export type FullProposal = {
  id: string;
  companyId: string;
  leadId: string;
  status: "draft" | "sent" | "signed" | "void";
  token: string | null;
  storedHash: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  lead: { name: string; phone: string | null; email: string | null; address: string | null; lat: number | null; lng: number | null };
  brand: Brand;
  content: ProposalContent;
  signature: {
    systemId: string; option: ProposalOption; addons: ProposalAddon[]; totalCents: number; signerName: string;
    signaturePath: string; ip: string | null; userAgent: string | null; contentHash: string; signedAt: string;
  } | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- rows shaped below */
/**
 * Everything to show or print a proposal, read with the service role. Callers
 * decide access: staff (checked by their own RLS read first) or the token.
 * Terms come from the proposal once sent, else from current settings.
 */
export async function loadFullProposal(by: { id: string } | { token: string }): Promise<FullProposal | null> {
  const db = adminClient();
  let query = db.from("proposals").select("*, leads(name, phone, email, address, lat, lng), proposal_signatures(*)");
  query = "id" in by ? query.eq("id", by.id) : query.eq("public_token", by.token);
  const { data: p } = await query.maybeSingle();
  if (!p) return null;
  const lead = (Array.isArray(p.leads) ? p.leads[0] : p.leads) as any;
  const sig = (Array.isArray(p.proposal_signatures) ? p.proposal_signatures[0] : p.proposal_signatures) as any;
  const brand = await roofingBrand(p.company_id);
  const terms = p.terms ?? (await loadProposalSettings(p.company_id)).terms;
  const content: ProposalContent = {
    number: p.number,
    brandName: brand.name,
    customerName: lead.name,
    address: lead.address,
    scope: scopeLines(p.measurement as Record<string, number>),
    options: (p.options as ProposalOption[]).map((o) => ({ ...o })),
    addons: p.addons as ProposalAddon[],
    terms,
  };
  return {
    id: p.id,
    companyId: p.company_id,
    leadId: p.lead_id,
    status: p.status,
    token: p.public_token,
    storedHash: p.content_hash,
    sentAt: p.sent_at,
    expiresAt: p.expires_at,
    viewedAt: p.viewed_at,
    signedAt: p.signed_at,
    lead: { name: lead.name, phone: lead.phone, email: lead.email, address: lead.address, lat: lead.lat, lng: lead.lng },
    brand,
    content,
    signature: sig
      ? {
          systemId: sig.system_id, option: sig.option, addons: sig.addons, totalCents: sig.total_cents,
          signerName: sig.signer_name, signaturePath: sig.signature_path, ip: sig.ip, userAgent: sig.user_agent,
          contentHash: sig.content_hash, signedAt: sig.signed_at,
        }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export { contentHash, optionPrice };

/** The drawn signature as a data URL, for the signed page and PDF. */
export async function signatureDataUrl(path: string): Promise<string | null> {
  const { data } = await adminClient().storage.from("signatures").download(path);
  if (!data) return null;
  return `data:image/png;base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`;
}
