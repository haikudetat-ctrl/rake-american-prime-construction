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
