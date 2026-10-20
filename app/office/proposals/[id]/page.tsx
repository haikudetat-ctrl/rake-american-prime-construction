import Link from "next/link";
import { notFound } from "next/navigation";
import { overrideOptionPrice } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import type { CostLine } from "@/lib/estimate/price";
import { formatCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Option = {
  systemId: string;
  name: string;
  brand: string;
  tierLabel: string;
  warranty: string;
  priceCents: number;
  overrideCents?: number;
  overrideReason?: string;
};
type Addon = { addonId: string; name: string; qty: number; unitLabel: string; priceCents: number };
type Costs = {
  catalogVersion: number;
  options: { systemId: string; costCents: number; marginPct: number; lines: CostLine[] }[];
  addons: { addonId: string; costCents: number }[];
};

const marginOf = (price: number, cost: number) => (price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0);

export default async function ProposalPage({ params, searchParams }: PageProps<"/office/proposals/[id]">) {
  const member = await requireStaff();
  const isOwner = member.role === "owner";
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: proposal } = await supabase
    .from("proposals")
    .select("*, leads(id, name, address)")
    .eq("id", id)
    .maybeSingle();
  if (!proposal) notFound();
  const lead = Array.isArray(proposal.leads) ? proposal.leads[0] : proposal.leads;
  // Owners only (RLS): the cost build-up behind each price.
  const { data: costRow } = isOwner
    ? await supabase.from("proposal_costs").select("breakdown").eq("proposal_id", id).maybeSingle()
    : { data: null };
  const costs = costRow?.breakdown as Costs | undefined;
  const options = proposal.options as Option[];
  const addons = proposal.addons as Addon[];
  const warnings = proposal.warnings as string[];
  const draft = proposal.status === "draft";

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href={`/office/leads/${lead?.id}`}>← {lead?.name}</Link></p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Estimate #{proposal.number}</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="pill">{proposal.status}</span>
          {draft && (
            <Link className="btn-secondary" href={`/office/leads/${lead?.id}/estimate?p=${proposal.id}&m=${proposal.measurement_id}`}>
              Change and re-price
            </Link>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">
        {lead?.address} · {proposal.measurement.squares} squares at {proposal.measurement.pitch}/12 · updated {formatDateTime(proposal.updated_at)}
        {costs && ` · price list v${costs.catalogVersion}`}
      </p>
      {proposal.needs_confirmation && (
        <p className="card border-warn/40 bg-warn/10 text-sm">
          Priced from placeholder numbers. Confirm the roofing price list before sending this to a homeowner.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="card list-disc space-y-1 pl-8 text-sm text-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {options.map((o) => {
          const cost = costs?.options.find((c) => c.systemId === o.systemId);
          const price = o.overrideCents ?? o.priceCents;
          return (
            <section key={o.systemId} className="card space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted">{o.tierLabel} · {o.brand}</p>
              <h2 className="font-semibold">{o.name}</h2>
              <p className="text-2xl font-semibold">{formatCents(price)}</p>
              {o.overrideCents !== undefined && (
                <p className="text-xs text-muted">Calculated {formatCents(o.priceCents)}; set by owner: {o.overrideReason}</p>
              )}
              {cost && (
                <p className="text-xs text-muted">
                  Cost {formatCents(cost.costCents)} · margin {marginOf(price, cost.costCents)}% (target {cost.marginPct}%)
                </p>
              )}
              {o.warranty && <p className="whitespace-pre-line text-xs">{o.warranty}</p>}
              {cost && (
                <details className="text-xs">
                  <summary className="cursor-pointer">Build-up</summary>
                  <table className="table mt-2 text-xs">
                    <tbody>
                      {cost.lines.map((l, i) => (
                        <tr key={i}>
                          <td>{l.name}</td>
                          <td className="text-right whitespace-nowrap">{l.qty} {l.unit} × {formatCents(l.unitCents)}</td>
                          <td className="text-right">{formatCents(l.totalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              {isOwner && draft && (
                <details className="text-xs">
                  <summary className="cursor-pointer">Set a different price</summary>
                  <form action={overrideOptionPrice} className="mt-2 space-y-2">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <input type="hidden" name="systemId" value={o.systemId} />
                    <input name="price" inputMode="decimal" placeholder="Price ($)" className="input" />
                    <input name="reason" placeholder="Why (kept on the lead)" className="input" />
                    <div className="flex gap-2">
                      <button className="btn-secondary">Set price</button>
                      {o.overrideCents !== undefined && <button name="clear" value="1" className="underline">Use calculated</button>}
                    </div>
                  </form>
                </details>
              )}
            </section>
          );
        })}
      </div>

      {addons.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-semibold">Add-ons</h2>
          <table className="table text-sm">
            <tbody>
              {addons.map((a) => {
                const cost = costs?.addons.find((c) => c.addonId === a.addonId);
                return (
                  <tr key={a.addonId}>
                    <td>{a.name}</td>
                    <td>{a.qty} {a.unitLabel}</td>
                    <td className="text-right">{formatCents(a.priceCents)}</td>
                    {cost && <td className="text-right text-xs text-muted">cost {formatCents(cost.costCents)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-xs text-muted">Sending and signing come next: this estimate stays a draft for now.</p>
    </>
  );
}
