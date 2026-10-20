import { DropAction, PickupAction, TicketAction } from "@/app/driver/stop-actions";
import { setLocale } from "@/app/driver/actions";
import { isStaff, requireDriver } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { messages, t as translate, type MessageKey } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BrandBar } from "@/app/_components/brand";

type RunStop = {
  stop_id: string;
  kind: "drop" | "pickup" | "dump";
  status: string;
  address: string;
  area: string | null;
  site_notes: string | null;
  rental_notes: string | null;
  customer_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  can_label: string | null;
  size_yards: number | null;
};

export default async function DriverPage({ searchParams }: PageProps<"/driver">) {
  const member = await requireDriver();
  const params = await searchParams;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : companyToday();
  const supabase = await createSupabaseServerClient();
  const [{ data: run }, { data: cans }, { data: landfills }] = await Promise.all([
    supabase.rpc("driver_run", { p_date: date }),
    supabase.from("cans").select("id, label, size_yards").eq("status", "available").order("label"),
    supabase.from("landfills").select("id, name").eq("is_active", true).order("created_at"),
  ]);
  const stops = (run ?? []) as RunStop[];
  const locale = member.locale;
  const tr = (key: MessageKey) => translate(locale, key);
  const allKeys = messages(locale);
  const canList = (cans ?? []).map((c) => ({ id: c.id, label: c.label, size: c.size_yards }));

  return (
    <>
      <BrandBar />
      <main className="mx-auto w-full max-w-md flex-1 space-y-3 p-3">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="page-title">{tr("driver.title")}</h1>
            <p className="text-sm text-muted">{formatDate(date, locale === "es" ? "es-US" : "en-US")} · {member.name}</p>
          </div>
          <div className="flex gap-2">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
              <button className="btn-secondary">{tr("driver.language")}</button>
            </form>
            {isStaff(member.role) ? (
              <a className="btn-secondary" href="/office">Office</a>
            ) : (
              <form action="/auth/signout" method="post"><button className="btn-secondary">{tr("driver.signOut")}</button></form>
            )}
          </div>
        </header>

        {stops.length === 0 && <p className="card text-muted">{tr("driver.empty")}</p>}

        {stops.map((stop, i) => {
          const done = stop.status === "done";
          return (
            <section key={stop.stop_id} className={`card space-y-3 ${done ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted">#{i + 1}</p>
                  <p className="text-lg font-semibold">
                    {tr(`driver.kind.${stop.kind}`)}
                    {(stop.can_label || stop.size_yards) && (
                      <span className="ml-2 text-base font-normal text-muted">
                        {stop.can_label ? `${tr("driver.can")} ${stop.can_label}` : `${stop.size_yards} yd`}
                      </span>
                    )}
                  </p>
                  <p>{stop.customer_name}</p>
                </div>
                {done && <span className="pill">{tr("driver.done")}</span>}
              </div>
              {stop.kind !== "dump" && (
                <div>
                  <p>{stop.address}</p>
                  {(stop.site_notes || stop.rental_notes) && (
                    <p className="text-sm text-muted">{[stop.site_notes, stop.rental_notes].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
              )}
              {!done && stop.kind !== "dump" && (
                <div className="grid grid-cols-2 gap-2">
                  <a className="btn-secondary py-3" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`}>
                    {tr("driver.map")}
                  </a>
                  {stop.contact_phone ? (
                    <a className="btn-secondary py-3" href={`tel:${stop.contact_phone}`}>
                      {tr("driver.call")} {stop.contact_name ?? formatPhone(stop.contact_phone)}
                    </a>
                  ) : <span />}
                </div>
              )}
              {!done && stop.kind === "drop" && <DropAction stopId={stop.stop_id} cans={canList} t={allKeys} />}
              {!done && stop.kind === "pickup" && <PickupAction stopId={stop.stop_id} t={allKeys} />}
              {!done && stop.kind === "dump" && (
                <TicketAction stopId={stop.stop_id} date={date} landfills={landfills ?? []} t={allKeys} />
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}
