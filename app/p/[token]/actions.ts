"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadFullProposal } from "@/lib/proposals/server";
import { adminClient } from "@/lib/supabase/admin";

const MAX_SIGNATURE_BYTES = 1_000_000;

/**
 * The homeowner signs. Reachable by anyone with the link, so everything is
 * checked here and again in sign_proposal, which also computes the total from
 * the stored proposal rather than anything the browser sent.
 */
export async function signProposal(token: string, form: FormData) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) notFound();
  const fail = (msg: string): never => redirect(`/p/${token}?error=${encodeURIComponent(msg)}`);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(form.get("signature") ?? ""));
  const png = m ? Buffer.from(m[1], "base64") : null;
  if (!png || png.length > MAX_SIGNATURE_BYTES || png.subarray(1, 4).toString() !== "PNG") return fail("Draw your signature again.");
  if (form.get("esign") !== "on") return fail("Tick the box agreeing to sign electronically.");

  const proposal = await loadFullProposal({ token });
  if (!proposal) notFound();
  const db = adminClient();
  const path = `${proposal.companyId}/${proposal.id}-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await db.storage.from("signatures").upload(path, png, { contentType: "image/png" });
  if (uploadError) return fail("We couldn't save your signature. Please try again.");

  const h = await headers();
  const { error } = await db.rpc("sign_proposal", {
    p_token: token,
    p_system_id: String(form.get("systemId") ?? ""),
    p_addon_ids: form.getAll("addonId").map(String),
    p_signer_name: String(form.get("signerName") ?? ""),
    p_signature_path: path,
    p_ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    p_user_agent: h.get("user-agent"),
    p_content_hash: String(form.get("contentHash") ?? ""),
  });
  if (error) {
    await db.storage.from("signatures").remove([path]);
    return fail(error.message);
  }
  // Deliver the signed copy and the office alert now, not on the next cron run.
  const { drainOutbox } = await import("@/lib/outbox/drain");
  await drainOutbox(5).catch(() => null);
  redirect(`/p/${token}`);
}
