import Link from "next/link";
import { addCan, requestPickup, setCanService } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Field } from "@/app/_ui/field";
import { Empty, Unavailable } from "@/app/_ui/states";
import { StatusPill, type Tone } from "@/app/_ui/status-pill";
import { Submit } from "@/app/_ui/submit";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday } from "@/lib/dates";
import { assignable, loadTeam, one } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "In yard", tone: "success" },
  on_site: { label: "On a job", tone: "neutral" },
  in_transit: { label: "Going to dump", tone: "neutral" },
  out_of_service: { label: "Out of service", tone: "danger" },
};

/** Fleet availability (Figma V2 46): which cans are out and for how long, and the state of every can. */
export default async function CansPage({ searchParams }: PageProps<"/office/cans">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: out, error: outError }, { data: cans, error: cansError }, { data: yards }, team] = await Promise.all([
    supabase.from("rentals_out").select("*").order("dropped_at"),
    supabase.from("cans").select("id, label, size_yards, status, yards(name)").order("label"),
    supabase.from("yards").select("id, name").eq("is_active", true).order("created_at"),
    loadTeam(supabase),
  ]);
  const people = assignable(team);
  const tomorrow = addDays(companyToday(), 1);
  const rentals = out ?? [];
  const fleet = cans ?? [];
  const inYard = fleet.filter((c) => c.status === "available").length;
  const extended = rentals.filter((r) => r.is_extended).length;

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Dumpsters · Cans</p>
        <h1 className="page-title">Fleet availability</h1>
        <p className="text-muted">
          {cansError
            ? "Cans could not load, so the counts are unknown."
            : `${inYard} of ${fleet.length} in the yard${outError ? "" : ` · ${rentals.length} out on rentals`}${extended ? ` · ${extended} past the included days` : ""}.`}
        </p>
      </header>

      <section aria-labelledby="out" className="space-y-2.5">
        <h2 id="out" className="text-xl font-semibold">Out on rentals</h2>
        {outError ? (
          <Unavailable area="Cans out" />
        ) : rentals.length === 0 ? (
          <Empty title="Every can is in the yard" />
        ) : (
          <ul className="space-y-3">
            {rentals.map((r) => (
              <li key={r.rental_id} className="grid gap-3 rounded-row border border-border/60 bg-surface px-4 py-3.5 sm:px-[18px] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0 text-sm">
                  <p className="text-base font-semibold">
                    {r.can_label} · {r.size_yards}-yard
                  </p>
                  <p className="break-words">
                    <Link className="font-semibold hover:underline" href={`/office/rentals/${r.rental_id}`}>{r.customer_name}</Link>
                    {" · "}{r.address}{r.area ? `, ${r.area}` : ""}
                  </p>
                  <p className={r.is_extended ? "font-semibold text-danger" : "text-muted"}>
                    {r.days_out === 1 ? "Out 1 day" : `Out ${r.days_out} days`}
                    {r.is_extended && ` · past ${r.extended_after_days} days, extended charge applies`}
                  </p>
                </div>
                {r.status === "pickup_requested" ? (
                  <StatusPill>Pickup scheduled</StatusPill>
                ) : (
                  <form action={requestPickup} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_11rem_auto] sm:items-end">
                    <input type="hidden" name="rentalId" value={r.rental_id} />
                    <Field label="Pickup day">
                      <input type="date" name="date" defaultValue={tomorrow} className="input" />
                    </Field>
                    <Field label="Driver">
                      <select name="driverId" className="input" defaultValue={people.find((p) => p.role === "driver")?.userId ?? ""}>
                        <option value="">Assign later</option>
                        {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                      </select>
                    </Field>
                    <Submit className="btn-secondary col-span-2 sm:col-span-1" pendingLabel="Scheduling…">Schedule pickup</Submit>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fleet" className="space-y-2.5">
        <h2 id="fleet" className="text-xl font-semibold">Every can</h2>
        {cansError ? (
          <Unavailable area="The fleet" />
        ) : fleet.length === 0 ? (
          <Empty title="No cans yet">Add the first can below.</Empty>
        ) : (
          <ul className="space-y-2">
            {fleet.map((c) => {
              const status = STATUS[c.status] ?? { label: c.status, tone: "neutral" as Tone };
              const canToggle = c.status === "available" || c.status === "out_of_service";
              return (
                <li key={c.id} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 rounded-row border border-border/60 bg-surface px-4 py-3 sm:px-[18px]">
                  <p className="min-w-0 flex-1">
                    <span className="font-semibold">{c.label} · {c.size_yards}-yard</span>
                    <span className="block text-sm text-muted">{one(c.yards)?.name ? `Home yard: ${one(c.yards)?.name}` : "No home yard"}</span>
                  </p>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  {canToggle && (
                    <form action={setCanService}>
                      <input type="hidden" name="canId" value={c.id} />
                      <input type="hidden" name="inService" value={c.status === "out_of_service" ? "1" : "0"} />
                      <Submit className="text-sm font-semibold text-accent underline-offset-2 hover:underline" pendingLabel="Saving…">
                        {c.status === "out_of_service" ? "Back in service" : "Take out of service"}
                      </Submit>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <details className="card">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Add a can</summary>
          <form action={addCan} className="grid gap-3 pt-3 sm:grid-cols-[8rem_8rem_minmax(0,14rem)_auto] sm:items-end">
            <Field label="Label"><input name="label" required className="input" placeholder="C10" /></Field>
            <Field label="Size (yd)"><input name="sizeYards" type="number" min={1} required className="input" defaultValue={20} /></Field>
            <Field label="Home yard">
              <select name="yardId" className="input">
                {(yards ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </Field>
            <Submit className="btn" pendingLabel="Adding…">Add can</Submit>
          </form>
        </details>
      </section>
    </>
  );
}
