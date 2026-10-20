import Link from "next/link";
import { addCan, requestPickup, setCanService } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday } from "@/lib/dates";
import { assignable, loadTeam, one } from "@/lib/office/team";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, string> = {
  available: "In yard",
  on_site: "On a job",
  in_transit: "Going to dump",
  out_of_service: "Out of service",
};

export default async function CansPage({ searchParams }: PageProps<"/office/cans">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: out }, { data: cans }, { data: yards }, team] = await Promise.all([
    supabase.from("rentals_out").select("*").order("dropped_at"),
    supabase.from("cans").select("id, label, size_yards, status, yards(name)").order("label"),
    supabase.from("yards").select("id, name").eq("is_active", true).order("created_at"),
    loadTeam(supabase),
  ]);
  const people = assignable(team);
  const tomorrow = addDays(companyToday(), 1);

  return (
    <>
      <Notice searchParams={params} />
      <h1 className="page-title">Cans out</h1>
      <section className="card overflow-x-auto">
        {(out ?? []).length === 0 ? (
          <p className="text-muted">Every can is in the yard.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Can</th><th>Customer</th><th>Where</th><th>Days out</th><th>Pickup</th></tr>
            </thead>
            <tbody>
              {(out ?? []).map((r) => (
                <tr key={r.rental_id}>
                  <td>{r.can_label} <span className="text-xs text-muted">{r.size_yards} yd</span></td>
                  <td><Link className="underline" href={`/office/rentals/${r.rental_id}`}>{r.customer_name}</Link></td>
                  <td>{r.address}{r.area && <div className="text-xs text-muted">{r.area}</div>}</td>
                  <td>
                    <span className={r.is_extended ? "font-semibold text-danger" : ""}>{r.days_out}</span>
                    {r.is_extended && <div className="text-xs text-danger">past {r.extended_after_days} days — extended charge</div>}
                  </td>
                  <td>
                    {r.status === "pickup_requested" ? (
                      <span className="pill">Scheduled</span>
                    ) : (
                      <form action={requestPickup} className="flex flex-wrap gap-1">
                        <input type="hidden" name="rentalId" value={r.rental_id} />
                        <input type="date" name="date" defaultValue={tomorrow} className="input w-auto py-1" />
                        <select name="driverId" className="input w-auto py-1"
                          defaultValue={people.find((p) => p.role === "driver")?.userId ?? ""}>
                          <option value="">Assign later</option>
                          {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                        </select>
                        <button className="btn-secondary py-1">Schedule</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <h2 className="text-lg font-semibold">Fleet</h2>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Can</th><th>Size</th><th>Home yard</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(cans ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>{c.size_yards} yd</td>
                <td>{one(c.yards)?.name ?? "—"}</td>
                <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                <td>
                  {(c.status === "available" || c.status === "out_of_service") && (
                    <form action={setCanService}>
                      <input type="hidden" name="canId" value={c.id} />
                      <input type="hidden" name="inService" value={c.status === "out_of_service" ? "1" : "0"} />
                      <button className="text-sm underline">
                        {c.status === "out_of_service" ? "Back in service" : "Out of service"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addCan} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="label"><span>Label</span><input name="label" required className="input w-28" placeholder="C10" /></label>
          <label className="label"><span>Size (yd)</span><input name="sizeYards" type="number" min={1} required className="input w-24" defaultValue={20} /></label>
          <label className="label">
            <span>Home yard</span>
            <select name="yardId" className="input w-auto">
              {(yards ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </label>
          <button className="btn">Add can</button>
        </form>
      </section>
    </>
  );
}
