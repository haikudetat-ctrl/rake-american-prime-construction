import type { ReactNode } from "react";
import { DropAction, PickupAction, TicketAction } from "@/app/driver/stop-actions";
import { setLocale } from "@/app/driver/actions";
import { Callout } from "@/app/_ui/callout";
import { Icon } from "@/app/_ui/icon";
import { BrandBar } from "@/app/_components/brand";
import { isStaff, requireDriver } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { directionsUrl, splitRun } from "@/lib/dispatch/driver-run";
import { messages, t as translate, type MessageKey } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";
import { loadPhoneSettings } from "@/lib/phone/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

/**
 * The driver's day as one next stop (Figma V2 49 to 52): where to go, where the can goes,
 * what the stop needs before it can be confirmed, and what comes after. The rest of the
 * run stays below, so a driver can still take stops out of order when the day changes.
 */
export default async function DriverPage({ searchParams }: PageProps<"/driver">) {
  const member = await requireDriver();
  const params = await searchParams;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : companyToday();
  const supabase = await createSupabaseServerClient();
  const [{ data: run }, { data: cans }, { data: landfills }, phone] = await Promise.all([
    supabase.rpc("driver_run", { p_date: date }),
    supabase.from("cans").select("id, label, size_yards").eq("status", "available").order("label"),
    supabase.from("landfills").select("id, name").eq("is_active", true).order("created_at"),
    // The business line, once one is set up. Until then there is no office button.
    loadPhoneSettings({ companyId: member.companyId }).catch(() => null),
  ]);
  const stops = (run ?? []) as RunStop[];
  const locale = member.locale;
  const tr = (key: MessageKey) => translate(locale, key);
  const allKeys = messages(locale);
  const canList = (cans ?? []).map((c) => ({ id: c.id, label: c.label, size: c.size_yards }));
  const office = phone?.businessNumber ?? null;
  const { next, position, after, later, done } = splitRun(stops);

  const action = (stop: RunStop) =>
    stop.kind === "drop" ? (
      <DropAction stopId={stop.stop_id} date={date} cans={canList} t={allKeys} />
    ) : stop.kind === "pickup" ? (
      <PickupAction stopId={stop.stop_id} date={date} t={allKeys} />
    ) : (
      <TicketAction stopId={stop.stop_id} date={date} landfills={landfills ?? []} t={allKeys} />
    );
  const title = (stop: RunStop) => `${tr(`driver.kind.${stop.kind}`)} · ${stop.kind === "dump" ? tr("driver.landfill") : stop.address}`;
  const canText = (stop: RunStop) =>
    stop.can_label ? `${tr("driver.can")} ${stop.can_label}${stop.size_yards ? ` · ${stop.size_yards} yd` : ""}` : stop.size_yards ? `${stop.size_yards} yd` : null;
  const placement = (stop: RunStop) => [stop.site_notes, stop.rental_notes].filter(Boolean).join(" · ");

  return (
    <>
      <BrandBar />
      <main className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 pt-4 pb-8">
        <header className="space-y-1">
          <p className="eyebrow">
            {formatDate(date, locale === "es" ? "es-US" : "en-US")} · {member.name}
          </p>
          <h1 className="page-title">{next ? tr("driver.nextStop") : tr("driver.title")}</h1>
        </header>

        <div className="grid grid-cols-3 gap-2">
          {next && next.kind !== "dump" ? (
            <a className="btn-secondary text-sm" href={directionsUrl(next.address)}>{tr("driver.directions")} ↗</a>
          ) : <span />}
          {office ? <a className="btn-secondary text-sm" href={`tel:${office}`}>{tr("driver.callOffice")}</a> : <span />}
          <form action={setLocale}>
            <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
            <button className="btn-secondary w-full text-sm" lang={locale === "en" ? "es" : "en"}>{tr("driver.language")}</button>
          </form>
        </div>

        {next && <Callout tone="warning">{tr("driver.parkFirst")}</Callout>}

        {stops.length === 0 && <p className="card text-muted">{tr("driver.empty")}</p>}
        {stops.length > 0 && !next && <Callout tone="success" title={tr("driver.allDone")} />}

        {next && (
          <>
            <section aria-labelledby="next-stop" className="space-y-2 rounded-rail bg-ok-soft p-[18px]">
              <h2 id="next-stop" className="text-xl font-semibold break-words">{title(next)}</h2>
              <p className="text-sm text-muted">
                {[canText(next), tr("driver.stopOf").replace("{n}", String(position)).replace("{total}", String(stops.length))].filter(Boolean).join(" · ")}
              </p>
            </section>

            {next.kind !== "dump" ? (
              <>
                <InfoCard title={tr("driver.placement")}>
                  {placement(next) || <span className="text-warn">{tr("driver.noPlacement")}</span>}
                </InfoCard>
                <InfoCard title={tr("driver.customer")}>
                  <p>{next.customer_name}{next.area ? ` · ${next.area}` : ""}</p>
                  {next.contact_phone && (
                    <a className="btn-secondary mt-2 w-full" href={`tel:${next.contact_phone}`}>
                      {tr("driver.call")} {next.contact_name ?? formatPhone(next.contact_phone)}
                    </a>
                  )}
                </InfoCard>
              </>
            ) : (
              <InfoCard title={tr("driver.landfill")}>{tr("driver.landfillNote")}</InfoCard>
            )}

            <section aria-labelledby="before-confirming" className="space-y-3 rounded-rail border border-border/60 bg-surface p-[18px]">
              <div>
                <h2 id="before-confirming" className="text-base font-semibold">{tr("driver.beforeConfirming")}</h2>
                <p className="text-sm text-muted">{tr(`driver.checklist.${next.kind}`)}</p>
              </div>
              {action(next)}
            </section>

            <InfoCard title={tr("driver.nextOnRun")}>{after ? title(after) : tr("driver.lastStop")}</InfoCard>
          </>
        )}

        {later.length > 0 && (
          <section aria-labelledby="later" className="space-y-2 pt-3">
            <h2 id="later" className="text-lg font-semibold">{tr("driver.later")}</h2>
            <ol className="space-y-2">
              {later.map((stop) => (
                <li key={stop.stop_id} className="rounded-row border border-border/60 bg-surface p-4">
                  <p className="font-semibold break-words">{title(stop)}</p>
                  <p className="text-sm text-muted">{[stop.kind !== "dump" ? stop.customer_name : null, canText(stop)].filter(Boolean).join(" · ")}</p>
                  <details className="mt-2">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-accent">{tr("driver.doThisOne")}</summary>
                    <div className="space-y-3 pt-2">
                      {stop.kind !== "dump" && (
                        <>
                          {placement(stop) && <p className="text-sm">{placement(stop)}</p>}
                          <a className="btn-secondary w-full" href={directionsUrl(stop.address)}>{tr("driver.directions")} ↗</a>
                        </>
                      )}
                      {action(stop)}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        )}

        {done.length > 0 && (
          <section aria-labelledby="done" className="space-y-2 pt-3">
            <h2 id="done" className="text-lg font-semibold">{tr("driver.doneToday")}</h2>
            <ul className="space-y-1">
              {done.map((stop) => (
                <li key={stop.stop_id} className="flex min-h-11 items-center gap-3 rounded-row bg-sunken px-4 py-2 text-sm text-muted">
                  <Icon name="check" size={18} className="shrink-0 text-ok" />
                  <span className="break-words">{title(stop)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="pt-4">
          {isStaff(member.role) ? (
            <a className="btn-secondary w-full" href="/office">{tr("driver.office")}</a>
          ) : (
            <form action="/auth/signout" method="post"><button className="btn-secondary w-full">{tr("driver.signOut")}</button></form>
          )}
        </div>
      </main>
    </>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1 rounded-rail border border-border/60 bg-surface p-[18px]">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="text-sm break-words text-muted">{children}</div>
    </section>
  );
}
