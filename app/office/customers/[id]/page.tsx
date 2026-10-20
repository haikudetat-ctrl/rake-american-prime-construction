import Link from "next/link";
import { notFound } from "next/navigation";
import { addContact, addSite, createRental, updateCustomer } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { assignable, loadTeam, one } from "@/lib/office/team";
import { formatPhone } from "@/lib/phone";
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

  return (
    <>
      <Notice searchParams={query} />
      <h1 className="page-title">{customer.name}</h1>

      <div className="grid gap-4 lg:grid-cols-2">
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
              <button className="btn sm:col-span-2">Book</button>
            </form>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Details</h2>
          <form action={updateCustomer} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="customerId" value={id} />
            <label className="label sm:col-span-2"><span>Name</span><input name="name" defaultValue={customer.name} required className="input" /></label>
            <label className="label"><span>Phone</span><input name="phone" defaultValue={customer.phone ?? ""} className="input" /></label>
            <label className="label"><span>Billing email</span><input name="billingEmail" type="email" defaultValue={customer.billing_email ?? ""} className="input" /></label>
            <label className="label"><span>Terms (days)</span><input name="terms" type="number" min={0} defaultValue={customer.payment_terms_days} className="input" /></label>
            <label className="label"><span>Notes</span><input name="notes" defaultValue={customer.notes ?? ""} className="input" /></label>
            <button className="btn-secondary sm:col-span-2 sm:justify-self-start">Save</button>
          </form>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Job addresses</h2>
          <ul className="space-y-1 text-sm">
            {(sites ?? []).map((s) => (
              <li key={s.id}>{s.address}{s.lat == null && <span className="ml-1 text-warn">(not on map)</span>}</li>
            ))}
          </ul>
          <form action={addSite} className="flex flex-wrap gap-2">
            <input type="hidden" name="customerId" value={id} />
            <input name="address" required placeholder="Street, town" className="input flex-1" />
            <button className="btn-secondary">Add address</button>
          </form>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">People who order</h2>
          <ul className="space-y-1 text-sm">
            {(contacts ?? []).map((c) => (
              <li key={c.id}>{c.name} · {formatPhone(c.phone)}{c.email && <> · {c.email}</>}</li>
            ))}
          </ul>
          <form action={addContact} className="grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="customerId" value={id} />
            <input name="name" required placeholder="Name" className="input" />
            <input name="phone" type="tel" placeholder="Phone" className="input" />
            <input name="email" type="email" placeholder="Email" className="input" />
            <button className="btn-secondary">Add</button>
          </form>
        </section>
      </div>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Rentals</h2>
        <table className="table">
          <thead><tr><th>Drop</th><th>Address</th><th>Can</th><th>Status</th><th>Invoice</th></tr></thead>
          <tbody>
            {(rentals ?? []).map((r) => {
              const invoice = one(r.invoices);
              return (
                <tr key={r.id}>
                  <td><Link className="underline" href={`/office/rentals/${r.id}`}>{formatDate(r.requested_drop_date)}</Link></td>
                  <td>{one(r.sites)?.address}</td>
                  <td>{one(r.cans)?.label ?? "—"}</td>
                  <td>{r.status.replaceAll("_", " ")}</td>
                  <td>{invoice ? <>#{invoice.number} · {formatCents(invoice.total_cents)} · {invoice.status.replace("_", " ")}</> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
