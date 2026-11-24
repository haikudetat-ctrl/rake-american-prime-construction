import Link from "next/link";
import { AddRentals } from "./_add-rentals";
import { assignStop, orderRun } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Callout } from "@/app/_ui/callout";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty, Unavailable } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate } from "@/lib/dates";
import {
  canLabel,
  dispatchSummary,
  fleetSnapshot,
  groupRuns,
  isOpen,
  kindLabel,
  needsDriver,
  type BoardCan,
  type BoardStop,
  type FleetSnapshot,
  type StopKind,
} from "@/lib/dispatch/board";
import { assignable, loadTeam, one, type TeamMember } from "@/lib/office/team";
import type { RentalContext } from "@/lib/rentals/add-rentals";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type StopRow = {
  id: string;
  kind: StopKind;
  status: string;
  sequence: number;
  driver_id: string | null;
  rentals: {
    id: string;
    size_yards: number | null;
    notes: string | null;
    customers: { name: string } | null;
    sites: { address: string; area: string | null; notes: string | null } | null;
    cans: { label: string } | null;
  } | null;
};

function toBoardStop(stop: StopRow): BoardStop {
  const rental = one(stop.rentals);
  const site = one(rental?.sites);
  return {
    id: stop.id,
    kind: stop.kind,
    status: stop.status,
    driverId: stop.driver_id,
    rentalId: rental?.id ?? null,
    customer: one(rental?.customers)?.name ?? null,
    address: site?.address ?? null,
    area: site?.area ?? null,
    placement: [site?.notes, rental?.notes].filter(Boolean).join(" · ") || null,
    can: one(rental?.cans)?.label ?? null,
    sizeYards: rental?.size_yards ?? null,
  };
}

/** Dispatch for one day (Figma V2 43): each driver's run in order, what needs a driver, and the yard. */
export default async function DispatchPage({ searchParams }: PageProps<"/office/dumpsters">) {
  await requireStaff();
  const params = await searchParams;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : companyToday();
  const supabase = await createSupabaseServerClient();

  const today = companyToday();
  const [{ data, error }, team, { data: yards }, { data: customers }, { data: cans, error: cansError }, { data: books }, { data: items }, { data: landfills }] = await Promise.all([
    supabase
      .from("stops")
      .select("id, kind, status, sequence, driver_id, rentals(id, size_yards, notes, customers(name), sites(address, area, notes), cans(label))")
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

  const stops = ((data ?? []) as unknown as StopRow[]).map(toBoardStop);
  const people = assignable(team);
  const runs = groupRuns(stops, people.map((p) => ({ userId: p.userId, name: p.name })));
  const waiting = needsDriver(runs);
  const fleet: FleetSnapshot | null = cansError || !cans
    ? null
    : fleetSnapshot(cans.map((c): BoardCan => ({ id: c.id, label: c.label, sizeYards: c.size_yards, status: c.status })), stops);
  const isToday = date === today;

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Dumpsters · Dispatch</p>
        <h1 className="page-title">{isToday ? "Today’s dispatch" : formatDate(date)}</h1>
        <p className="text-muted">
          {isToday ? `${formatDate(date)} · ` : ""}
          {error ? "Stops could not load, so the count is unknown." : dispatchSummary(stops, waiting.length)}
        </p>
      </header>

      <nav aria-label="Dispatch date" className="flex flex-wrap items-center gap-2">
        <Link className="btn-secondary" href={`/office/dumpsters?date=${addDays(date, -1)}`}>‹ Previous day</Link>
        {!isToday && <Link className="btn-secondary" href="/office/dumpsters">Today</Link>}
        <Link className="btn-secondary" href={`/office/dumpsters?date=${addDays(date, 1)}`}>Next day ›</Link>
        <Link className="btn-secondary" href="/office/cans">Fleet availability</Link>
      </nav>

      <WithRail rail={<DispatchRail date={date} waiting={waiting} fleet={fleet} />}>
        <div className="space-y-7">
          {error && <Unavailable area="Dispatch">Reload to try again. Nothing below is shown as empty until it loads.</Unavailable>}
          {!error && runs.length === 0 && (
            <Empty title="No stops scheduled">Approve a request or add a rental below, and its drop shows up here.</Empty>
          )}

          {runs.map((run) => (
            <section key={run.driverId ?? "none"} id={run.driverId ? undefined : "not-assigned"} aria-labelledby={`run-${run.driverId ?? "none"}`} className="space-y-2.5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id={`run-${run.driverId ?? "none"}`} className="text-xl font-semibold">
                    {run.driverId ? `${run.name}’s run` : "Needs a driver"}
                  </h2>
                  <p className="text-sm text-muted">
                    {run.driverId
                      ? `${run.stops.length === 1 ? "1 stop" : `${run.stops.length} stops`} in the order the driver sees them${run.open < run.stops.length ? ` · ${run.stops.length - run.open} done` : ""}.`
                      : "Pick a driver for each stop below."}
                  </p>
                </div>
                {run.driverId && run.open > 1 && (yards ?? []).length > 0 && (
                  <form action={orderRun} className="flex items-center gap-2">
                    <input type="hidden" name="date" value={date} />
                    <input type="hidden" name="driverId" value={run.driverId} />
                    <label className="sr-only" htmlFor={`yard-${run.driverId}`}>Start from</label>
                    <select id={`yard-${run.driverId}`} name="yardId" className="input w-auto">
                      {(yards ?? []).map((y) => <option key={y.id} value={y.id}>From {y.name}</option>)}
                    </select>
                    <button className="btn-secondary">Order run</button>
                  </form>
                )}
              </div>

              <div aria-hidden="true" className="hidden gap-4 px-[18px] text-xs font-semibold tracking-wide text-muted uppercase md:grid md:grid-cols-[7rem_minmax(0,1fr)_8.5rem_8rem]">
                <span>Order / task</span>
                <span>Site / placement</span>
                <span>Can</span>
                <span>Status</span>
              </div>
              <ol className="space-y-3">
                {run.stops.map((stop, i) => (
                  <StopItem key={stop.id} stop={stop} order={i + 1} date={date} people={people} />
                ))}
              </ol>
            </section>
          ))}

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
        </div>
      </WithRail>
    </>
  );
}

function StopItem({ stop, order, date, people }: { stop: BoardStop; order: number; date: string; people: TeamMember[] }) {
  const done = stop.status === "done";
  const where = stop.kind === "dump" ? "Landfill" : stop.address ?? "No address";
  const note = stop.kind === "dump" ? "Record the ticket and weight" : stop.placement;
  return (
    <li className={`rounded-row border bg-surface px-4 py-3.5 sm:px-[18px] ${done ? "border-border/40 opacity-60" : "border-border/60"}`}>
      <div className="grid gap-2 md:grid-cols-[7rem_minmax(0,1fr)_8.5rem_8rem] md:items-start md:gap-4">
        <p className="text-sm font-semibold uppercase">
          {order} · {kindLabel(stop.kind)}
        </p>
        <div className="min-w-0 text-sm">
          {stop.rentalId ? (
            <Link href={`/office/rentals/${stop.rentalId}`} className="font-semibold break-words hover:underline">{where}</Link>
          ) : (
            <p className="font-semibold break-words">{where}</p>
          )}
          <p className="break-words text-muted">
            {[stop.customer, stop.area].filter(Boolean).join(" · ")}
          </p>
          {note ? (
            <p className="break-words">{note}</p>
          ) : stop.kind !== "dump" && !done ? (
            <p className="text-warn">No placement note yet</p>
          ) : null}
        </div>
        <p className="text-sm">{canLabel(stop)}</p>
        <div>
          {done ? (
            <StatusPill tone="success">Done</StatusPill>
          ) : stop.driverId ? (
            <StatusPill>Assigned</StatusPill>
          ) : (
            <StatusPill tone="warning">Needs a driver</StatusPill>
          )}
        </div>
      </div>
      {isOpen(stop) && (
        <details className="mt-2 border-t border-border/60 pt-2" open={!stop.driverId}>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-accent">
            {stop.driverId ? "Change driver or day" : "Assign a driver"}
          </summary>
          <form action={assignStop} className="grid gap-2 pt-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto] sm:items-end">
            <input type="hidden" name="stopId" value={stop.id} />
            <input type="hidden" name="date" value={date} />
            <label className="label">
              <span>Driver</span>
              <select name="driverId" defaultValue={stop.driverId ?? ""} className="input">
                <option value="">Not assigned</option>
                {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </select>
            </label>
            <label className="label">
              <span>Day</span>
              <input type="date" name="newDate" defaultValue={date} className="input" />
            </label>
            <button className="btn-secondary">Save</button>
          </form>
        </details>
      )}
    </li>
  );
}

function DispatchRail({ date, waiting, fleet }: { date: string; waiting: BoardStop[]; fleet: FleetSnapshot | null }) {
  return (
    <>
      {waiting.length > 0 && (
        <section className="space-y-3 rounded-rail bg-warn-soft p-5">
          <h2 className="text-xl font-bold">{waiting.length === 1 ? "1 stop needs a driver" : `${waiting.length} stops need a driver`}</h2>
          <ul className="space-y-2">
            {waiting.slice(0, 3).map((s) => (
              <li key={s.id}>
                <p className="text-xs font-semibold tracking-wide text-warn uppercase">
                  {kindLabel(s.kind)}{s.sizeYards ? ` · ${s.sizeYards}-yard` : ""}
                </p>
                <p className="font-semibold break-words">{s.kind === "dump" ? "Landfill" : s.address ?? "No address"}</p>
              </li>
            ))}
          </ul>
          {waiting.length > 3 && <p className="text-sm">and {waiting.length - 3} more.</p>}
          <a href="#not-assigned" className="btn w-full">Review and assign</a>
        </section>
      )}

      <RailCard title="In the yard now">
        {!fleet ? (
          <p role="status" className="text-danger">Cans could not load. Reload to try again.</p>
        ) : (
          <>
            {fleet.inYard.length === 0 ? (
              <p>No cans in the yard.</p>
            ) : (
              <ul className="text-base font-medium">
                {fleet.inYard.map((c) => <li key={c.id}>{c.label} · {c.sizeYards}-yard</li>)}
              </ul>
            )}
            <p className="text-muted">
              {fleet.out === 1 ? "1 can out" : `${fleet.out} cans out`}
              {fleet.outOfService ? ` · ${fleet.outOfService} out of service` : ""}
            </p>
            {fleet.short.map((s) => (
              <Callout key={s.sizeYards} tone="warning">
                {s.drops} open {s.sizeYards}-yard {s.drops === 1 ? "drop" : "drops"} on {formatDate(date)}, {s.inYard} in the yard now. Pickups may free one up.
              </Callout>
            ))}
            <Link href="/office/cans" className="text-xs font-semibold text-accent hover:underline">All cans</Link>
          </>
        )}
      </RailCard>

      <p className="px-3 text-xs text-muted">No live truck tracking. This is the recorded run order; drivers mark stops done from their phones.</p>
    </>
  );
}
