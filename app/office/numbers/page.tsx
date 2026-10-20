import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { addDays, companyToday, formatDate, weekStart } from "@/lib/dates";
import { cansNeeded, fleetVerdict, maxDaysPerTurn } from "@/lib/metrics/turnaround";
import { SOURCE_LABEL, STAGE_LABEL, winRate, type Stage } from "@/lib/leads/schema";
import { formatCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The goal from the discovery call: 20 rentals a week within six months. */
const WEEKLY_TARGET = 20;

export default async function NumbersPage({ searchParams }: PageProps<"/office/numbers">) {
  await requireStaff();
  const params = await searchParams;
  const week = typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week)
    ? weekStart(params.week)
    : weekStart(companyToday());
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("weekly_numbers", { p_week_start: week }).single<{
    rentals_dropped: number;
    rentals_picked_up: number;
    avg_days_out: number | null;
    avg_days_pickup_to_invoice: number | null;
    cans_in_service: number;
    cans_out: number;
    unbilled_cents: number;
    open_balance_cents: number;
    overdue_cents: number;
  }>();
  if (!data) return <p className="card">Numbers are unavailable.</p>;

  const avgOut = data.avg_days_out === null ? null : Number(data.avg_days_out);
  const perTurn = maxDaysPerTurn(data.cans_in_service, WEEKLY_TARGET);
  const verdict = fleetVerdict(data.cans_in_service, avgOut, WEEKLY_TARGET);

  const tiles = [
    { label: "Rentals dropped", value: String(data.rentals_dropped), note: `Goal ${WEEKLY_TARGET} a week` },
    { label: "Picked up", value: String(data.rentals_picked_up) },
    { label: "Avg days a can is out", value: avgOut === null ? "—" : String(avgOut), note: perTurn ? `≤ ${perTurn.toFixed(1)} to hit ${WEEKLY_TARGET}/week with ${data.cans_in_service} cans` : undefined },
    { label: "Pickup to invoice", value: data.avg_days_pickup_to_invoice === null ? "—" : `${data.avg_days_pickup_to_invoice} days` },
    { label: "Cans out now", value: `${data.cans_out} of ${data.cans_in_service}` },
    { label: "Not billed yet", value: formatCents(data.unbilled_cents) },
    { label: "Owed to you", value: formatCents(data.open_balance_cents) },
    { label: "Overdue", value: formatCents(data.overdue_cents) },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Week of {formatDate(week)}</h1>
        <div className="flex gap-2">
          <Link className="btn-secondary" href={`/office/numbers?week=${addDays(week, -7)}`}>← Prev</Link>
          <Link className="btn-secondary" href="/office/numbers">This week</Link>
          <Link className="btn-secondary" href={`/office/numbers?week=${addDays(week, 7)}`}>Next →</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="text-2xl font-semibold">{tile.value}</p>
            {tile.note && <p className="text-xs text-muted">{tile.note}</p>}
          </div>
        ))}
      </div>
      {verdict && avgOut !== null && (
        <p className="card text-sm">
          At {avgOut} days out per rental, {WEEKLY_TARGET} rentals a week needs about{" "}
          <strong>{cansNeeded(avgOut, WEEKLY_TARGET)} cans</strong>; you have {data.cans_in_service}.{" "}
          {verdict === "enough" && "The fleet can handle it."}
          {verdict === "tight" && "That's tight: any slow pickup means turning a job away."}
          {verdict === "short" && "Get pickups sooner, or plan for more cans."}
        </p>
      )}
      <RoofingNumbers />
      <ReviewNumbers />
      <CashView />
    </>
  );
}

const ROOFING_DAYS = 90;

/** The sales side: what is in the pipeline now, and how the last 90 days closed. */
async function RoofingNumbers() {
  const supabase = await createSupabaseServerClient();
  const since = addDays(companyToday(), -ROOFING_DAYS);
  const { data } = await supabase.rpc("lead_numbers", { p_since: since }).single<{
    by_stage: Partial<Record<Stage, number>>;
    new_since: number;
    by_source: Record<string, number>;
    won: number;
    lost: number;
    stale_proposals: number;
    uncontacted: number;
  }>();
  if (!data) return null;
  const rate = winRate(data.won, data.lost);
  const open = (["new", "contacted", "appointment", "proposal_sent"] as Stage[])
    .map((s) => `${STAGE_LABEL[s]} ${data.by_stage[s] ?? 0}`).join(" · ");
  const tiles = [
    { label: "Proposals out", value: String(data.by_stage.proposal_sent ?? 0), note: data.stale_proposals ? `${data.stale_proposals} waiting over a week` : undefined },
    { label: "Not contacted yet", value: String(data.by_stage.new ?? 0), note: data.uncontacted ? `${data.uncontacted} over a day old` : undefined },
    { label: `Win rate, last ${ROOFING_DAYS} days`, value: rate === null ? "—" : `${rate}%`, note: `${data.won} won, ${data.lost} lost` },
    { label: `New leads, last ${ROOFING_DAYS} days`, value: String(data.new_since) },
  ];
  const sources = Object.entries(data.by_source).sort((a, b) => b[1] - a[1]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Roofing</h2>
        <Link className="text-sm underline" href="/office/leads">Open the pipeline</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="text-2xl font-semibold">{tile.value}</p>
            {tile.note && <p className="text-xs text-warn">{tile.note}</p>}
          </div>
        ))}
      </div>
      <p className="card text-sm">
        Open now: {open}.
        {sources.length > 0 && <> Where leads came from: {sources.map(([s, n]) => `${SOURCE_LABEL[s] ?? s} ${n}`).join(", ")}.</>}
      </p>
    </section>
  );
}

const CASH_WEEKS = 8;

/** Money out, money in, and money owed: so a big payroll week reads next to the payments still coming. */
async function CashView() {
  const supabase = await createSupabaseServerClient();
  const from = addDays(weekStart(companyToday()), -7 * (CASH_WEEKS - 1));
  const [{ data: weeks }, { data: owed }] = await Promise.all([
    supabase.rpc("cash_weeks", { p_from: from, p_weeks: CASH_WEEKS }),
    supabase.rpc("money_owed").single<{ roofing_cents: number; dumpster_cents: number }>(),
  ]);
  const rows = (weeks ?? []) as { week_start: string; cash_out_cents: number; cash_in_cents: number }[];
  if (!owed) return null;
  const owedTotal = Number(owed.roofing_cents) + Number(owed.dumpster_cents);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Cash</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card"><p className="text-sm text-muted">Owed to you</p><p className="text-2xl font-semibold">{formatCents(owedTotal)}</p>
          <p className="text-xs text-muted">Roofing {formatCents(Number(owed.roofing_cents))} · dumpsters {formatCents(Number(owed.dumpster_cents))}</p></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="table text-sm">
          <thead><tr><th>Week of</th><th className="text-right">Money out</th><th className="text-right">Money in</th><th className="text-right">Net</th></tr></thead>
          <tbody>
            {rows.map((w) => {
              const net = Number(w.cash_in_cents) - Number(w.cash_out_cents);
              return (
                <tr key={w.week_start}>
                  <td>{formatDate(w.week_start)}</td>
                  <td className="text-right">{formatCents(Number(w.cash_out_cents))}</td>
                  <td className="text-right">{formatCents(Number(w.cash_in_cents))}</td>
                  <td className={`text-right ${net < 0 ? "text-danger" : "text-ok"}`}>{net < 0 ? `−${formatCents(-net)}` : formatCents(net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Out: crew pay, supplier bills, permits and stock buys. In: roofing and dumpster payments. A negative week is normal when
          payroll lands before the customers pay; check &quot;Owed to you&quot; next to it.
        </p>
      </div>
    </section>
  );
}

/** Aftercare: did finished jobs turn into reviews and referrals? */
async function ReviewNumbers() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("review_numbers", { p_since: addDays(companyToday(), -ROOFING_DAYS) }).single<{
    finals: number; responses: number; great: number; review_clicks: number; open_follow_ups: number;
    referrals: number; referrals_won: number; rewards_owed_cents: number;
  }>();
  if (!data) return null;
  const tiles = [
    { label: "Jobs marked final", value: String(data.finals), note: `${data.responses} answered "how did we do?"` },
    { label: "Rated great", value: String(data.great), note: `${data.review_clicks} opened the Google review` },
    { label: "Referrals", value: String(data.referrals), note: `${data.referrals_won} signed` },
    { label: "Rewards owed", value: formatCents(Number(data.rewards_owed_cents)), note: data.open_follow_ups ? `${data.open_follow_ups} unhappy customer(s) to call` : undefined },
  ];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Reviews and referrals, last {ROOFING_DAYS} days</h2>
        <Link className="text-sm underline" href="/office/referrals">Referrals</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card">
            <p className="text-sm text-muted">{tile.label}</p>
            <p className="text-2xl font-semibold">{tile.value}</p>
            {tile.note && <p className="text-xs text-muted">{tile.note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
