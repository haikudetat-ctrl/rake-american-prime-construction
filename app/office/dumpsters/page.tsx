import Link from "next/link";
import { AddRentals } from "./_add-rentals";
import { assignStop, orderRun } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate } from "@/lib/dates";
import { assignable, loadTeam, one } from "@/lib/office/team";
import type { RentalContext } from "@/lib/rentals/add-rentals";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const KIND_LABEL = { drop: "Drop", pickup: "Pickup", dump: "Dump" } as const;

type StopRow = {
  id: string;
  kind: keyof typeof KIND_LABEL;
  status: string;
  sequence: number;
  driver_id: string | null;
  rentals: {
    id: string;
    size_yards: number | null;
    customers: { name: string } | null;
    sites: { address: string; area: string | null } | null;
    cans: { label: string } | null;
  } | null;
};

export default async function TodayPage({ searchParams }: PageProps<"/office/dumpsters">) {
  await requireStaff();
  const params = await searchParams;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : companyToday();
  const supabase = await createSupabaseServerClient();

  const today = companyToday();
  const [{ data, error }, team, { data: yards }, { data: customers }, { data: cans }, { data: books }, { data: items }, { data: landfills }] = await Promise.all([
    supabase
      .from("stops")
      .select("id, kind, status, sequence, driver_id, rentals(id, size_yards, customers(name), sites(address, area), cans(label))")
      .eq("scheduled_date", date)
      .neq("status", "cancelled")
      .order("sequence")
      .order("created_at"),
    loadTeam(supabase),
    supabase.from("yards").select("id, name").eq("is_active", true).order("created_at"),
    // What the add-rentals form needs to price each rental before it goes in.
    supabase.from("customers").select("id, name, sites(id, address, created_at)").eq("is_active", true).order("name"),
    supabase.from("cans").select("id, label, size_yards, status").order("label"),
    supabase.from("price_books").select("id, version, created_at, delivery_fee_cents, extended_after_days, extended_fee_cents_per_day").order("version"),
    supabase.from("dumpster_price_items").select("id, description, unit, unit_cents").eq("is_active", true).order("description"),
    supabase.from("landfills").select("id, name").eq("is_active", true).order("name"),
  ]);
  const context: RentalContext = {
    today,
    customers: (customers ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      // Newest address first: the likeliest one for the next rental.
      sites: [...(c.sites ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((x) => ({ id: x.id, address: x.address })),
    })),
    cans: (cans ?? []).map((c) => ({ id: c.id, label: c.label, sizeYards: c.size_yards, inYard: c.status === "available" })),
    books: (books ?? []).map((b) => ({
      id: b.id, version: b.version, createdOn: companyToday(new Date(b.created_at)),
      deliveryCents: b.delivery_fee_cents, afterDays: b.extended_after_days, perDayCents: b.extended_fee_cents_per_day,
    })),
    items: (items ?? []).map((i) => ({ id: i.id, description: i.description, unit: i.unit, unitCents: i.unit_cents })),
  };
  const stops = (data ?? []) as unknown as StopRow[];
  const people = assignable(team);
  const groups = [
    ...people.map((p) => ({ driverId: p.userId as string | null, name: p.name, stops: stops.filter((s) => s.driver_id === p.userId) })),
    { driverId: null, name: "Not assigned", stops: stops.filter((s) => !s.driver_id) },
  ].filter((g) => g.stops.length > 0);

  return (
    <>
      <Notice searchParams={params} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1 className="page-title">{formatDate(date)}</h1>
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" href={`/office/dumpsters?date=${addDays(date, -1)}`}>← Prev</Link>
          <Link className="btn-secondary" href="/office/dumpsters">Today</Link>
          <Link className="btn-secondary" href={`/office/dumpsters?date=${addDays(date, 1)}`}>Next →</Link>
        </div>
      </div>

      {customers && cans && books && items ? (
        <details id="add-rentals" className="card">
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">Add rentals</span>
            <span className="text-sm text-muted">One, a list, or ones that already happened</span>
          </summary>
          <div className="mt-3">
            {customers.length === 0 ? (
              <p className="text-sm text-muted">Add a customer in <Link className="underline" href="/office/customers">Customers</Link> first.</p>
            ) : (
              <AddRentals context={context} landfills={landfills ?? []} defaultDate={date < today ? today : date} />
            )}
          </div>
        </details>
      ) : (
        <p role="status" className="card text-sm text-muted">Adding rentals is unavailable right now. Reload to try again.</p>
      )}

      {error && <p role="alert" className="card">Dispatch is unavailable. Reload to try again.</p>}
      {!error && groups.length === 0 && <p className="card text-muted">Nothing scheduled.</p>}

      {groups.map((group) => (
        <section key={group.driverId ?? "none"} className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {group.name} <span className="text-sm font-normal text-muted">· {group.stops.length} stops</span>
            </h2>
            {group.driverId && (yards ?? []).length > 0 && (
              <form action={orderRun} className="flex items-center gap-2">
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="driverId" value={group.driverId} />
                <select name="yardId" className="input w-auto">
                  {(yards ?? []).map((y) => <option key={y.id} value={y.id}>From {y.name}</option>)}
                </select>
                <button className="btn-secondary">Order run</button>
              </form>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>#</th><th>Stop</th><th>Customer</th><th>Where</th><th>Can</th><th>Move</th></tr>
              </thead>
              <tbody>
                {group.stops.map((stop, i) => {
                  const rental = one(stop.rentals);
                  const site = one(rental?.sites);
                  return (
                    <tr key={stop.id} className={stop.status === "done" ? "opacity-50" : ""}>
                      <td>{i + 1}</td>
                      <td>
                        <span className="pill">{KIND_LABEL[stop.kind]}</span>
                        {stop.status === "done" && <span className="ml-1 text-xs text-ok">done</span>}
                      </td>
                      <td>{rental && <Link className="underline" href={`/office/rentals/${rental.id}`}>{one(rental.customers)?.name}</Link>}</td>
                      <td>
                        <div>{site?.address}</div>
                        {site?.area && <div className="text-xs text-muted">{site.area}</div>}
                      </td>
                      <td>{one(rental?.cans)?.label ?? (rental?.size_yards ? `${rental.size_yards} yd` : "—")}</td>
                      <td>
                        {stop.status === "scheduled" && (
                          <form action={assignStop} className="flex flex-wrap gap-1">
                            <input type="hidden" name="stopId" value={stop.id} />
                            <input type="hidden" name="date" value={date} />
                            <select name="driverId" defaultValue={stop.driver_id ?? ""} className="input w-auto py-1">
                              <option value="">Unassigned</option>
                              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                            </select>
                            <input type="date" name="newDate" defaultValue={date} className="input w-auto py-1" />
                            <button className="btn-secondary py-1">Save</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
