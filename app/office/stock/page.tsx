import Link from "next/link";
import { buyStock, countStock, createStockItem } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { companyToday, formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const KIND = { buy: "Bought", pull: "Pulled", return: "Returned", count: "Count fixed" } as const;

/** Bulk stock: what's on the shelf, what it cost on average, and every move. */
export default async function StockPage({ searchParams }: PageProps<"/office/stock">) {
  await requireStaff();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: items }, { data: moves }] = await Promise.all([
    supabase.from("stock_items").select("*").eq("is_active", true).order("name"),
    supabase.from("stock_moves").select("*, stock_items(name, unit), roofing_jobs(customer_name)").order("created_at", { ascending: false }).limit(40),
  ]);
  const value = (items ?? []).reduce((s, i) => s + Math.max(0, Number(i.on_hand)) * Number(i.avg_cost_cents), 0);
  const today = companyToday();

  return (
    <>
      <Notice searchParams={query} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Stock</h1>
        <p className="text-sm text-muted">On the shelf: {formatCents(Math.round(value))} at average cost</p>
      </div>
      <p className="text-sm text-muted">
        Bulk buys add to the shelf and set the average cost. Pull stock for a job from the job&apos;s page; it&apos;s charged at the average cost.
      </p>

      <section className="card overflow-x-auto">
        <table className="table text-sm">
          <thead><tr><th>Item</th><th className="text-right">On hand</th><th className="text-right">Avg cost</th><th>Record a buy</th><th>Fix the count</th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className={`text-right ${Number(i.on_hand) <= 0 ? "text-warn" : ""}`}>{Number(i.on_hand)} {i.unit}</td>
                <td className="text-right">{formatCents(Math.round(Number(i.avg_cost_cents)))}</td>
                <td>
                  <form action={buyStock} className="flex flex-wrap gap-1">
                    <input type="hidden" name="itemId" value={i.id} />
                    <input name="qty" required placeholder="Qty" inputMode="decimal" className="input w-16" />
                    <input name="total" required placeholder="Total $" inputMode="decimal" className="input w-24" />
                    <input name="vendor" placeholder="Supplier" className="input w-28" />
                    <input name="reference" placeholder="Invoice #" className="input w-24" />
                    <input name="boughtOn" type="date" defaultValue={today} className="input w-36" />
                    <button className="btn-secondary">Add</button>
                  </form>
                </td>
                <td>
                  <form action={countStock} className="flex gap-1">
                    <input type="hidden" name="itemId" value={i.id} />
                    <input name="onHand" required placeholder="Count" inputMode="decimal" className="input w-20" />
                    <button className="btn-secondary">Set</button>
                  </form>
                </td>
              </tr>
            ))}
            {(items ?? []).length === 0 && <tr><td colSpan={5} className="text-muted">No stock items yet.</td></tr>}
          </tbody>
        </table>
        <form action={createStockItem} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="label"><span>New item</span><input name="name" required placeholder="Synthetic underlayment" className="input" /></label>
          <label className="label"><span>Unit</span><input name="unit" placeholder="roll" className="input w-24" /></label>
          <button className="btn-secondary">Add item</button>
        </form>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Recent moves</h2>
        <table className="table text-sm">
          <tbody>
            {(moves ?? []).map((m) => {
              const item = Array.isArray(m.stock_items) ? m.stock_items[0] : m.stock_items;
              const job = Array.isArray(m.roofing_jobs) ? m.roofing_jobs[0] : m.roofing_jobs;
              return (
                <tr key={m.id}>
                  <td>{formatDate(m.moved_on)}</td>
                  <td>{KIND[m.kind as keyof typeof KIND]}</td>
                  <td>{item?.name}</td>
                  <td className="text-right">{Number(m.qty) > 0 ? "+" : ""}{Number(m.qty)} {item?.unit}</td>
                  <td className="text-right">{m.total_cents ? formatCents(Math.abs(m.total_cents)) : ""}</td>
                  <td>{job ? <Link className="underline" href={`/office/jobs/${m.job_id}`}>{job.customer_name}</Link> : (m.vendor ?? m.note ?? "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
