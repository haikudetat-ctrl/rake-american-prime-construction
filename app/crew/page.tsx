import { setLocale } from "@/app/driver/actions";
import { setRoofingJobStatus } from "@/app/office/actions";
import { isStaff, requireTeamMember } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { t as translate, type MessageKey } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CrewJob = {
  job_id: string;
  customer_name: string;
  customer_phone: string | null;
  address: string | null;
  system_name: string;
  scope: { measurement: Record<string, number>; addons: { name: string; qty: number; unit: string }[] };
  status: "scheduled" | "in_progress" | "done";
  install_date: string | null;
  notes: string | null;
};

/** A crew member's roofing jobs: where, what, and Start/Done. Never prices. */
export default async function CrewPage() {
  const member = await requireTeamMember();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("crew_jobs");
  const jobs = (data ?? []) as CrewJob[];
  const locale = member.locale;
  const tr = (key: MessageKey) => translate(locale, key);
  const dateLocale = locale === "es" ? "es-US" : "en-US";

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-3 p-3">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{tr("crew.title")}</h1>
          <p className="text-sm text-muted">{member.name}</p>
        </div>
        <div className="flex gap-2">
          <form action={setLocale}>
            <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
            <button className="btn-secondary">{tr("driver.language")}</button>
          </form>
          {isStaff(member.role) ? (
            <a className="btn-secondary" href="/office">Office</a>
          ) : member.role === "driver" ? (
            <a className="btn-secondary" href="/driver">{tr("driver.title")}</a>
          ) : (
            <form action="/auth/signout" method="post"><button className="btn-secondary">{tr("driver.signOut")}</button></form>
          )}
        </div>
      </header>

      {jobs.length === 0 && <p className="card text-muted">{tr("crew.empty")}</p>}
      {jobs.map((j) => {
        const m = j.scope.measurement ?? {};
        return (
          <section key={j.job_id} className={`card space-y-2 ${j.status === "done" ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">{j.customer_name}</p>
                <p>{j.address}</p>
              </div>
              {j.status !== "scheduled" && <span className="pill">{tr(j.status === "done" ? "crew.finished" : "crew.inProgress")}</span>}
            </div>
            <p className="text-sm">
              {tr("crew.install")}: {j.install_date ? formatDate(j.install_date, dateLocale) : tr("crew.notScheduled")}
            </p>
            <p className="text-sm">{tr("crew.system")}: <strong>{j.system_name}</strong></p>
            <p className="text-sm text-muted">
              {tr("crew.scope")}: {m.squares} sq · {m.pitch}/12 · {m.layers} layer(s) · {m.deck_sheets ?? 0} deck · {m.pipe_boots ?? 0} boots
            </p>
            {j.scope.addons?.length > 0 && (
              <p className="text-sm">{tr("crew.addons")}: {j.scope.addons.map((a) => `${a.name} (${a.qty} ${a.unit})`).join(", ")}</p>
            )}
            {j.notes && <p className="text-sm">{tr("crew.notes")}: {j.notes}</p>}
            <div className="grid grid-cols-2 gap-2">
              {j.address && (
                <a className="btn-secondary py-3" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.address)}`}>
                  {tr("driver.map")}
                </a>
              )}
              {j.customer_phone && (
                <a className="btn-secondary py-3" href={`tel:${j.customer_phone}`}>{tr("driver.call")} {formatPhone(j.customer_phone)}</a>
              )}
            </div>
            {j.status !== "done" && (
              <form action={setRoofingJobStatus}>
                <input type="hidden" name="jobId" value={j.job_id} />
                <input type="hidden" name="returnTo" value="/crew" />
                {j.status === "scheduled"
                  ? <button name="status" value="in_progress" className="btn w-full py-4 text-lg">{tr("crew.start")}</button>
                  : <button name="status" value="done" className="btn w-full py-4 text-lg">{tr("crew.done")}</button>}
              </form>
            )}
          </section>
        );
      })}
    </main>
  );
}
