import Link from "next/link";
import { markRewardPaid, voidReferral } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { STAGE_LABEL, type Stage } from "@/lib/leads/schema";
import { formatCents } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS = { pending: "Pending", earned: "Reward owed", paid: "Paid", void: "Void" } as const;
const ORDER = { earned: 0, pending: 1, paid: 2, void: 3 } as const;

/** Who sent whom, and the rewards: owed once the friend's roof is paid in full. */
export default async function ReferralsPage({ searchParams }: PageProps<"/office/referrals">) {
  const member = await requireStaff();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("referrals")
    .select("*, leads(id, name, stage), aftercare(customer_name, customer_phone, lead_id)")
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []).sort((a, b) => ORDER[a.status as keyof typeof ORDER] - ORDER[b.status as keyof typeof ORDER]);
  const owed = rows.filter((r) => r.status === "earned").reduce((s, r) => s + r.reward_cents, 0);

  return (
    <>
      <Notice searchParams={query} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Referrals</h1>
        <p className="text-sm">Rewards owed: <strong>{formatCents(owed)}</strong></p>
      </div>
      <section className="card overflow-x-auto">
        <table className="table text-sm">
          <thead><tr><th>Referred by</th><th>Friend</th><th>Friend&apos;s stage</th><th>Reward</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const friend = Array.isArray(r.leads) ? r.leads[0] : r.leads;
              const referrer = Array.isArray(r.aftercare) ? r.aftercare[0] : r.aftercare;
              return (
                <tr key={r.id}>
                  <td><Link className="underline" href={`/office/leads/${referrer?.lead_id}`}>{referrer?.customer_name}</Link></td>
                  <td><Link className="underline" href={`/office/leads/${friend?.id}`}>{friend?.name}</Link></td>
                  <td>{friend ? STAGE_LABEL[friend.stage as Stage] : ""}</td>
                  <td>{formatCents(r.reward_cents)}</td>
                  <td>
                    {STATUS[r.status as keyof typeof STATUS]}
                    {r.paid_at && <div className="text-xs text-muted">{formatDate(r.paid_at.slice(0, 10))} · {r.paid_method}{r.paid_reference && ` · ${r.paid_reference}`}</div>}
                    {r.void_reason && <div className="text-xs text-muted">{r.void_reason}</div>}
                  </td>
                  <td>
                    {member.role === "owner" && r.status === "earned" && (
                      <form action={markRewardPaid} className="flex flex-wrap gap-1">
                        <input type="hidden" name="referralId" value={r.id} />
                        <select name="method" className="input w-32">
                          <option value="gift_card">Gift card</option>
                          <option value="bank">Bank transfer</option>
                          <option value="check">Check</option>
                          <option value="other">Other</option>
                        </select>
                        <input name="reference" placeholder="Card # / ref" className="input w-28" />
                        <button className="btn-secondary">Mark paid</button>
                      </form>
                    )}
                    {member.role === "owner" && (r.status === "pending" || r.status === "earned") && (
                      <details className="text-xs">
                        <summary className="cursor-pointer">Void</summary>
                        <form action={voidReferral} className="mt-1 flex gap-1">
                          <input type="hidden" name="referralId" value={r.id} />
                          <input name="reason" required placeholder="Why" className="input" />
                          <button className="btn-secondary">Void</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="text-muted">No referrals yet. Customers get their link after a great rating.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">
        A reward is owed once the friend&apos;s roof is paid in full. Pay it by gift card or bank transfer, then mark it paid here;
        the customer gets a thank-you text.
      </p>
    </>
  );
}
