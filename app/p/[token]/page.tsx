import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Flash } from "@/app/_components/flash";
import { signProposal } from "@/app/p/[token]/actions";
import { SignForm } from "@/app/p/[token]/sign-form";
import { formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { optionPrice } from "@/lib/proposals/content";
import { loadFullProposal, signatureDataUrl } from "@/lib/proposals/server";
import { adminClient } from "@/lib/supabase/admin";
import { BrandBar } from "@/app/_components/brand";

export const metadata: Metadata = { title: "Your roofing proposal", robots: { index: false, follow: false } };

export default async function ProposalPublicPage({ params, searchParams }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) notFound();
  const p = await loadFullProposal({ token });
  if (!p || p.status === "draft") notFound();
  const expired = p.status === "sent" && p.expiresAt !== null && new Date(p.expiresAt) < new Date();
  if (p.status === "sent" && !expired) await adminClient().rpc("record_proposal_view", { p_token: token });

  const { brand, content } = p;
  const signature = p.signature;
  const signatureImage = signature ? await signatureDataUrl(signature.signaturePath) : null;

  return (
    <>
      <BrandBar name={brand.name}>
        <a className="shrink-0 text-sm font-semibold whitespace-nowrap text-orange-300 hover:text-orange-200" href={`/p/${token}/pdf`}>
          <span className="sm:hidden">PDF</span>
          <span className="hidden sm:inline">Download PDF</span>
        </a>
      </BrandBar>
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm text-muted">
              {brand.phone && <a className="underline" href={`tel:${brand.phone}`}>{formatPhone(brand.phone)}</a>}
              {brand.email && <> · {brand.email}</>}
            </p>
          </div>
        </header>

        {typeof query.error === "string" && <Flash tone="error">{query.error}</Flash>}
        {p.status === "void" && <Flash tone="error">This proposal has been replaced. Please use the newest link we sent you.</Flash>}
        {expired && <Flash tone="error">This proposal has expired. Call or text us for an updated one.</Flash>}

        {/* eslint-disable-next-line @next/next/no-img-element -- server-proxied satellite image */}
        <img src={`/p/${token}/satellite`} alt={`Satellite view of ${content.address ?? "the house"}`}
          className="aspect-[16/9] w-full rounded-md bg-ink-active object-cover" />
        <div>
          <p className="text-xs font-bold tracking-widest text-accent uppercase">Proposal #{content.number}</p>
          <h1 className="page-title">Your new roof</h1>
          <p className="text-muted">{content.customerName}{content.address && ` · ${content.address}`}</p>
        </div>

        <section className="card space-y-1">
          <h2 className="font-semibold">Scope of work</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{content.scope.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {(signature ? [signature.option] : content.options).map((o) => (
            <div key={o.systemId} className={`card-stripe space-y-1 ${signature ? "border-2 border-t-4 border-accent" : ""}`}>
              <p className="text-xs font-bold tracking-wider text-muted uppercase">{o.tierLabel} · {o.brand}</p>
              <p className="font-semibold">{o.name}</p>
              <p className="stat-value">{formatCents(optionPrice(o))}</p>
              {o.warranty && <p className="whitespace-pre-line text-xs text-muted">{o.warranty}</p>}
            </div>
          ))}
        </section>

        {!signature && content.addons.length > 0 && (
          <section className="card text-sm">
            <h2 className="mb-1 font-semibold">Optional add-ons</h2>
            {content.addons.map((a) => (
              <p key={a.addonId} className="flex justify-between"><span>{a.name} ({a.qty} {a.unitLabel})</span><span>{formatCents(a.priceCents)}</span></p>
            ))}
          </section>
        )}

        <details className="card text-sm">
          <summary className="cursor-pointer font-semibold">Terms</summary>
          <p className="mt-2 whitespace-pre-line text-xs">{content.terms}</p>
        </details>

        {signature ? (
          <section className="card space-y-2">
            <Flash tone="ok">Signed by {signature.signerName} on {formatDateTime(signature.signedAt)}. Thank you — we&apos;ll be in touch to schedule.</Flash>
            {signature.addons.map((a) => (
              <p key={a.addonId} className="flex justify-between text-sm"><span>{a.name}</span><span>{formatCents(a.priceCents)}</span></p>
            ))}
            <p className="flex justify-between font-semibold"><span>Total</span><span>{formatCents(signature.totalCents)}</span></p>
            {/* eslint-disable-next-line @next/next/no-img-element -- the homeowner's own signature */}
            {signatureImage && <img src={signatureImage} alt="Your signature" className="h-20" />}
          </section>
        ) : p.status === "sent" && !expired ? (
          <SignForm options={content.options} addons={content.addons} contentHash={p.storedHash ?? ""} action={signProposal.bind(null, token)} />
        ) : null}
        {p.status === "sent" && p.expiresAt && !expired && (
          <p className="text-xs text-muted">Prices good until {formatDateTime(p.expiresAt)}.</p>
        )}
      </main>
    </>
  );
}
