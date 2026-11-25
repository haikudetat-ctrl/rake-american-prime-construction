import Link from "next/link";
import { notFound } from "next/navigation";
import { addContact, addSite, createRental, updateCustomer } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Callout } from "@/app/_ui/callout";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
import { StatusPill, type Tone } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { assignable, loadTeam, one } from "@/lib/office/team";
import { formatPhone, toE164 } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CustomerPage({ params, searchParams }: PageProps<"/office/customers/[id]">) {
  await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: customer }, { data: contacts }, { data: sites }, { data: rentals }, team] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase.from("customer_contacts").select("*").eq("customer_id", id).order("created_at"),
    supabase.from("sites").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase
      .from("rentals")
      .select("id, status, requested_drop_date, dropped_at, picked_up_at, sites(address), cans(label), invoices(number, total_cents, status)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    loadTeam(supabase),
  ]);
  if (!customer) notFound();
  const people = assignable(team);

  const email = customer.billing_email?.trim();
  const phone = customer.phone ? toE164(customer.phone) : null;
  const RENTAL_STATUS: Record<string, { label: string; tone: Tone }> = {
    scheduled: { label: "Scheduled", tone: "neutral" },
    on_site: { label: "On site", tone: "neutral" },
    pickup_requested: { label: "Pickup asked", tone: "warning" },
    picked_up: { label: "Needs ticket", tone: "warning" },
    closed: { label: "Closed", tone: "success" },
    cancelled: { label: "Cancelled", tone: "neutral" },
  };

  return (
    <>
      <Notice searchParams={query} />
      <header className="space-y-1">
        <p className="eyebrow">Office · Customers</p>
        <h1 className="page-title">{customer.name}</h1>
        <nav aria-label="Contact" className="flex flex-wrap gap-2 pt-1">
          {phone && <a className="btn-secondary" href={`tel:${phone}`}>Call {formatPhone(phone)}</a>}
          {phone && <Link className="btn-secondary" href={`/office/inbox/${encodeURIComponent(phone)}`}>Texts</Link>}
          {email && <a className="btn-secondary" href={`mailto:${email}`}>Email billing</a>}
        </nav>
      </header>

      {!email && (
        <Callout tone="warning" title="No billing email on file">
          Statements for {customer.name} still issue, but nothing is emailed. Add a billing email under Details, or download and send each statement yourself.
        </Callout>
      )}

      <WithRail
        rail={
          <RailCard title="Details and billing">
            <form action={updateCustomer} className="space-y-2">
              <input type="hidden" name="customerId" value={id} />
              <label className="label"><span>Name</span><input name="name" defaultValue={customer.name} required className="input" /></label>
              <label className="label"><span>Phone</span><input name="phone" defaultValue={customer.phone ?? ""} className="input" /></label>
              <label className="label"><span>Billing email</span><input name="billingEmail" type="email" defaultValue={customer.billing_email ?? ""} className="input" /></label>
              <label className="label"><span>Terms (days)</span><input name="terms" type="number" min={0} defaultValue={customer.payment_terms_days} className="input" /></label>
              <label className="label"><span>Notes</span><input name="notes" defaultValue={customer.notes ?? ""} className="input" /></label>
              <button className="btn-secondary w-full">Save details</button>
            </form>
          </RailCard>
        }
      >
        <section className="card space-y-3">
          <h2 className="font-semibold">Book a dumpster</h2>
          {(sites ?? []).length === 0 ? (
            <p className="text-sm text-muted">Add a job address below first.</p>
          ) : (
            <form action={createRental} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="customerId" value={id} />
              <label className="label sm:col-span-2">
                <span>Address</span>
                <select name="siteId" className="input">
                  {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.address}</option>)}
                </select>
              </label>
              <label className="label"><span>Drop date</span>
                <input type="date" name="dropDate" required defaultValue={addDays(companyToday(), 1)} className="input" />
              </label>
              <label className="label"><span>Driver</span>
                <select name="driverId" className="input" defaultValue={people.find((p) => p.role === "driver")?.userId ?? ""}>
                  <option value="">Assign later</option>
                  {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </select>
              </label>
              <label className="label"><span>Size (yd)</span><input name="sizeYards" type="number" min={1} className="input" /></label>
              <label className="label"><span>Notes for driver</span><input name="notes" className="input" /></label>
              <button className="btn sm:col-span-2 sm:justify-self-start">Book</button>
            </form>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card space-y-3">
            <h2 className="font-semibold">Job addresses</h2>
            {(sites ?? []).length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="space-y-1.5 text-sm">
                {(sites ?? []).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">{s.address}{s.lat == null && <StatusPill tone="warning">Not on map</StatusPill>}</li>
                ))}
              </ul>
            )}
            <form action={addSite} className="flex flex-wrap gap-2">
              <input type="hidden" name="customerId" value={id} />
              <input name="address" required placeholder="Street, town" aria-label="New job address" className="input flex-1" />
              <button className="btn-secondary">Add address</button>
            </form>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold">People who order</h2>
            {(contacts ?? []).length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="space-y-1.5 text-sm">
                {(contacts ?? []).map((c) => (
                  <li key={c.id}>{c.name} · {formatPhone(c.phone)}{c.email && <> · {c.email}</>}</li>
                ))}
              </ul>
            )}
            <form action={addContact} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="customerId" value={id} />
              <input name="name" required placeholder="Name" aria-label="Contact name" className="input" />
              <input name="phone" type="tel" placeholder="Phone" aria-label="Contact phone" className="input" />
              <input name="email" type="email" placeholder="Email" aria-label="Contact email" className="input" />
              <button className="btn-secondary">Add person</button>
            </form>
          </section>
        </div>

        <section aria-labelledby="rentals" className="space-y-2.5">
          <h2 id="rentals" className="text-base">Rentals <span className="font-normal text-muted">{(rentals ?? []).length || ""}</span></h2>
          {(rentals ?? []).length === 0 ? (
            <Empty title="No rentals yet" />
          ) : (
            <WorkList label="Rentals" headings={["Drop / address", "Can / invoice"]}>
              {(rentals ?? []).map((r) => {
                const invoice = one(r.invoices);
                const status = RENTAL_STATUS[r.status] ?? { label: r.status.replaceAll("_", " "), tone: "neutral" as Tone };
                return (
                  <WorkRow
                    key={r.id}
                    href={`/office/rentals/${r.id}`}
                    title={`${formatDate(r.requested_drop_date)} · ${one(r.sites)?.address ?? ""}`}
                    detail={[one(r.cans)?.label ? `Can ${one(r.cans)?.label}` : "No can yet", invoice ? `invoice #${invoice.number} · ${formatCents(invoice.total_cents)} · ${invoice.status.replaceAll("_", " ")}` : null].filter(Boolean).join(" · ")}
                    aside={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
                  />
                );
              })}
            </WorkList>
          )}
        </section>
      </WithRail>
    </>
  );
}
