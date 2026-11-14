import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addAdjustment,
  cancelPickup,
  cancelRental,
  removeAdjustment,
  swapCan,
  undoStop,
  voidInvoice,
} from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { addInvoiceCharges } from "@/app/office/dumpsters/actions";
import { ConfirmAction } from "@/app/_ui/confirm-action";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadTeam, one } from "@/lib/office/team";
import { adminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS: Record<string, string> = {
  scheduled: "Scheduled",
  on_site: "On the job",
  pickup_requested: "Pickup scheduled",
  picked_up: "Going to the dump",
  closed: "Done",
  cancelled: "Cancelled",
};
const KIND = { drop: "Drop", pickup: "Pickup", dump: "Dump" } as const;
const LINE_ORDER = ["delivery", "extended_days", "tonnage", "charge", "adjustment"];
const CHARGE_UNIT: Record<string, string> = { each: "each", day: "a day", ton: "a ton", hour: "an hour", trip: "a trip" };

function when(at: string | null) {
  return at ? new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "";
}

export default async function RentalPage({ params, searchParams }: PageProps<"/office/rentals/[id]">) {
  const member = await requireStaff();
  const isOwner = member.role === "owner";
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: rental }, { data: stops }, { data: invoice }, { data: ticket }, { data: cans }, team, { data: events }, { data: stopPhotos }, { data: charges }] =
    await Promise.all([
      supabase
        .from("rentals")
        .select("*, customers(id, name), sites(address, area, notes), cans(label, size_yards), price_books(version, delivery_fee_cents, extended_after_days, extended_fee_cents_per_day)")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("stops").select("*").eq("rental_id", id).order("created_at"),
      supabase.from("invoices").select("*, invoice_lines(*), statements(id, number)").eq("rental_id", id).maybeSingle(),
      supabase.from("scale_tickets").select("*, landfills(name)").eq("rental_id", id).maybeSingle(),
      supabase.from("cans").select("id, label, size_yards").eq("status", "available").order("label"),
      loadTeam(supabase),
      supabase.from("domain_events").select("event_type, payload, actor_id, occurred_at").eq("aggregate_id", id).order("occurred_at", { ascending: false }).limit(30),
      supabase.from("stop_photos").select("id, kind, path, taken_by, taken_at").eq("rental_id", id).order("taken_at"),
      supabase.from("dumpster_price_items").select("id, description, unit, unit_cents").eq("is_active", true).order("description"),
    ]);
  // RLS already scoped every read above to staff of this company.
  if (!rental) notFound();

  // The photo bucket is private; a short-lived link is minted only after the
  // ticket row was readable under the staff member's own RLS.
  let photoUrl: string | null = null;
  if (ticket?.photo_path) {
    const { data } = await adminClient().storage.from("scale-tickets").createSignedUrl(ticket.photo_path, 600);
    photoUrl = data?.signedUrl ?? null;
  }

  // Drop and pickup photos, same rule: rows were readable under RLS first.
  const photoLinks = new Map<string, string>();
  if (stopPhotos?.length) {
    const { data } = await adminClient().storage.from("stop-photos").createSignedUrls(stopPhotos.map((p) => p.path), 600);
    for (const link of data ?? []) if (link.path && link.signedUrl) photoLinks.set(link.path, link.signedUrl);
  }

  const names = new Map(team.map((m) => [m.userId, m.name]));
  const customer = one(rental.customers);
  const site = one(rental.sites);
  const can = one(rental.cans);
  const book = one(rental.price_books);
  const lines = [...(invoice?.invoice_lines ?? [])].sort(
    (a, b) => LINE_ORDER.indexOf(a.kind) - LINE_ORDER.indexOf(b.kind) || String(a.created_at).localeCompare(String(b.created_at)),
  );
  // Entered by the office after it happened (add_rentals): there were never any photos.
  const recorded = (events ?? []).some((e) => e.event_type === "rental_recorded");
  const invoiceOpen = invoice && (invoice.status === "draft" || invoice.status === "final");
  const statement = one(invoice?.statements);
  // Only the newest completed step can be undone (the database enforces this too).
  const lastDone = [...(stops ?? [])].filter((s) => s.status === "done").sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0];

  return (
    <>
      <Notice searchParams={query} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">
          {customer?.name} · {site?.address}
        </h1>
        <span className="pill">{STATUS[rental.status] ?? rental.status}</span>
      </div>
      <p className="text-sm text-muted">
        <Link className="underline" href={`/office/customers/${customer?.id}`}>Customer</Link> · Drop requested{" "}
        {formatDate(rental.requested_drop_date)}
        {can && <> · Can {can.label} ({can.size_yards} yd)</>}
        {book && <> · Price book v{book.version}: {formatCents(book.delivery_fee_cents)} delivery</>}
        {rental.cancel_reason && <> · Cancelled: {rental.cancel_reason}</>}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Steps</h2>
          <ul className="space-y-2 text-sm">
            {(stops ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{KIND[s.kind as keyof typeof KIND]}</strong> · {formatDate(s.scheduled_date)} ·{" "}
                  {names.get(s.driver_id) ?? "unassigned"} ·{" "}
                  {s.status === "done" ? <span className="text-ok">done {when(s.completed_at)}</span> : s.status}
                </span>
                {isOwner && lastDone?.id === s.id && invoice?.status !== "on_statement" && invoice?.status !== "paid" && (
                  <form action={undoStop}>
                    <input type="hidden" name="rentalId" value={id} />
                    <input type="hidden" name="stopId" value={s.id} />
                    <button className="text-sm underline">Undo</button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {rental.status === "scheduled" && (
            <div className="border-t border-border pt-3">
              <ConfirmAction
                action={cancelRental}
                trigger="Cancel rental"
                title="Cancel this rental?"
                hidden={{ rentalId: id }}
                reason={{ label: "Why (internal)", placeholder: "Customer called it off…", required: false }}
                effects={[
                  "The rental is marked cancelled. Your reason stays internal.",
                  "Its scheduled drop comes off the driver's run.",
                  "Nothing was billed yet, so there's no invoice to void.",
                  "The customer isn't told. Call them if they're expecting the can.",
                ]}
                acknowledgment="Cancel this rental."
                submitLabel="Cancel rental"
                pendingLabel="Cancelling…"
                recheckHref={`/office/rentals/${id}`}
              />
            </div>
          )}
          {rental.status === "pickup_requested" && (
            <form action={cancelPickup} className="border-t border-border pt-3">
              <input type="hidden" name="rentalId" value={id} />
              <button className="btn-secondary">Cancel the scheduled pickup</button>
            </form>
          )}
          {(rental.status === "on_site" || rental.status === "pickup_requested") && (
            <form action={swapCan} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <input type="hidden" name="rentalId" value={id} />
              <label className="label">
                <span>Wrong can recorded? Actual can:</span>
                <select name="canId" className="input w-auto" required defaultValue="">
                  <option value="" disabled>—</option>
                  {(cans ?? []).map((c) => <option key={c.id} value={c.id}>{c.label} · {c.size_yards} yd</option>)}
                </select>
              </label>
              <button className="btn-secondary">Change can</button>
            </form>
          )}
          {!isOwner && lastDone && <p className="text-xs text-muted">An owner can undo the last driver step.</p>}
        </section>

        <section className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              Invoice {invoice ? `#${invoice.number}` : ""}
            </h2>
            {invoice && (
              <span className="text-sm text-muted">
                {invoice.status === "void" ? `Void: ${invoice.void_reason}` : invoice.status.replace("_", " ")}
                {statement && <> · <Link className="underline" href={`/office/billing/${statement.id}`}>statement #{statement.number}</Link></>}
              </span>
            )}
          </div>
          {!invoice ? (
            <p className="text-sm text-muted">The invoice opens when the can is dropped.</p>
          ) : (
            <>
              <table className="table">
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.description}</td>
                      <td className="text-right">{formatCents(line.amount_cents)}</td>
                      <td className="w-px">
                        {(line.kind === "adjustment" || line.kind === "charge") && invoiceOpen && (
                          <form action={removeAdjustment}>
                            <input type="hidden" name="rentalId" value={id} />
                            <input type="hidden" name="lineId" value={line.id} />
                            <button className="text-xs underline">remove</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold">Total</td>
                    <td className="text-right font-semibold">{formatCents(invoice.total_cents)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>

              {invoiceOpen && (charges ?? []).length > 0 && (
                <form action={addInvoiceCharges} className="space-y-2 border-t border-border pt-3">
                  <input type="hidden" name="rentalId" value={id} />
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <p className="text-sm font-medium">Extra charges: fill in how many of each</p>
                  <ul className="divide-y divide-border/60 rounded-row border border-border/60">
                    {(charges ?? []).map((c) => (
                      <li key={c.id}>
                        <label className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span>{c.description}<span className="block text-xs text-muted">{formatCents(c.unit_cents)} {CHARGE_UNIT[c.unit] ?? c.unit}</span></span>
                          <input name={`qty:${c.id}`} inputMode="decimal" placeholder="0" aria-label={`How many ${c.description}`} className="input w-24" />
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button className="btn-secondary">Add charges</button>
                </form>
              )}

              {invoiceOpen ? (
                <form action={addAdjustment} className="grid gap-2 border-t border-border pt-3 sm:grid-cols-4 sm:items-end">
                  <input type="hidden" name="rentalId" value={id} />
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <label className="label sm:col-span-2"><span>Adjustment</span>
                    <input name="description" required placeholder="e.g. Credit for late delivery" className="input" />
                  </label>
                  <label className="label"><span>Amount ($)</span>
                    <input name="amount" required inputMode="decimal" className="input" />
                  </label>
                  <select name="direction" className="input">
                    <option value="credit">Credit</option>
                    <option value="charge">Extra charge</option>
                  </select>
                  <button className="btn-secondary sm:col-span-4 sm:justify-self-start">Add to invoice</button>
                </form>
              ) : (
                invoice.status !== "void" && (
                  <p className="text-xs text-muted">
                    This invoice is on a statement. To change it, an owner voids the statement first
                    (only possible before any payment).
                  </p>
                )
              )}

              {isOwner && invoiceOpen && (
                <div className="border-t border-border pt-3">
                  <ConfirmAction
                    action={voidInvoice}
                    trigger="Void invoice"
                    title={`Void invoice #${invoice.number}?`}
                    hidden={{ rentalId: id, invoiceId: invoice.id }}
                    reason={{ label: "Reason for voiding", placeholder: "Duplicate rental, billed elsewhere…" }}
                    effects={[
                      `Invoice #${invoice.number} for ${formatCents(invoice.total_cents)} is voided and stays on record with your reason.`,
                      "It will not be billed: it never goes on a statement.",
                      "There's no undo, so this rental can't be billed from Rake after this.",
                    ]}
                    acknowledgment={`Void invoice #${invoice.number}.`}
                    submitLabel="Void invoice"
                    pendingLabel="Voiding…"
                    recheckHref={`/office/rentals/${id}`}
                  />
                </div>
              )}
            </>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Drop and pickup photos</h2>
          {!stopPhotos?.length ? (
            <p className="text-sm text-muted">
              {recorded ? "None: the office recorded this rental after it happened." : "The driver adds these at the drop and the pickup."}
            </p>
          ) : (
            (["drop", "pickup"] as const).map((kind) => {
              const shots = stopPhotos.filter((p) => p.kind === kind);
              if (!shots.length) return null;
              return (
                <div key={kind} className="space-y-1">
                  <p className="text-sm">
                    <strong>{kind === "drop" ? "Where it was placed" : "The load at pickup"}</strong>
                    <span className="text-muted"> · {when(shots[0].taken_at)} by {names.get(shots[0].taken_by) ?? "unknown"}</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {shots.map((p) =>
                      photoLinks.get(p.path) ? (
                        <a key={p.id} href={photoLinks.get(p.path)} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable */}
                          <img src={photoLinks.get(p.path)} alt={kind === "drop" ? "Can as placed at drop-off" : "Load at pickup"}
                            className="aspect-[4/3] w-full rounded-md border border-border object-cover" />
                        </a>
                      ) : (
                        <p key={p.id} className="text-sm text-muted">Photo unavailable.</p>
                      ),
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Scale ticket</h2>
          {!ticket ? (
            <p className="text-sm text-muted">Not recorded yet.</p>
          ) : (
            <>
              <p className="text-sm">
                {Number(ticket.tons)} tons · {formatCents(ticket.fee_cents)} · {one(ticket.landfills)?.name ?? "landfill not set"}
                {ticket.ticket_number && <> · #{ticket.ticket_number}</>} · entered {when(ticket.entered_at)} by{" "}
                {names.get(ticket.entered_by) ?? "unknown"}
              </p>
              {photoUrl ? (
                <a href={photoUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable */}
                  <img src={photoUrl} alt="Scale ticket photo" className="max-h-96 rounded-md border border-border" />
                </a>
              ) : (
                <p className="text-sm text-muted">No photo was taken.</p>
              )}
            </>
          )}
        </section>

        <section className="card space-y-2">
          <h2 className="font-semibold">History</h2>
          <ul className="space-y-1 text-sm">
            {(events ?? []).map((e, i) => (
              <li key={i}>
                <span className="text-muted">{when(e.occurred_at)}</span> · {e.event_type.replaceAll("_", " ")}
                {e.actor_id && <> · {names.get(e.actor_id) ?? "someone"}</>}
                {typeof e.payload?.reason === "string" && e.payload.reason && <> · “{e.payload.reason}”</>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
