import { approveRequest, declineRequest } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Field } from "@/app/_ui/field";
import { Empty, Unavailable } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { Submit } from "@/app/_ui/submit";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { assignable, loadTeam } from "@/lib/office/team";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Rental requests (Figma V2 44 and 45): who wants a can, where and when, and the one decision each needs. */
export default async function RequestsPage({ searchParams }: PageProps<"/office/requests">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: requests, error }, { data: customers }, team, { data: links }] = await Promise.all([
    supabase.from("rental_requests").select("*").eq("status", "pending").order("requested_date"),
    supabase.from("customers").select("id, name, phone, billing_email").eq("is_active", true).order("name"),
    loadTeam(supabase),
    supabase.from("request_links").select("slug").eq("is_active", true),
  ]);
  const people = assignable(team);
  const list = requests ?? [];

  // Suggest the existing customer whose phone or name matches the request.
  const match = (r: { phone: string; company_name: string | null; email: string | null }) =>
    (customers ?? []).find(
      (c) =>
        c.phone === r.phone ||
        (r.email && c.billing_email?.toLowerCase() === r.email.toLowerCase()) ||
        (r.company_name && c.name.toLowerCase() === r.company_name.toLowerCase()),
    )?.id ?? "new";

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Dumpsters · Requests</p>
        <h1 className="page-title">Rental requests</h1>
        <p className="text-muted">
          {error ? "Requests could not load, so the count is unknown." : list.length === 0 ? "Nothing waiting." : list.length === 1 ? "1 request waiting, soonest first." : `${list.length} requests waiting, soonest first.`}
          {links?.[0] && (
            <> Customers send these from <code className="text-sm">{process.env.APP_URL ?? ""}/request/{links[0].slug}</code>.</>
          )}
        </p>
      </header>

      {error && <Unavailable area="Rental requests" />}
      {!error && list.length === 0 && <Empty title="No requests waiting">New requests from the website land here and on Today.</Empty>}

      <ul className="space-y-4">
        {list.map((r) => {
          const existing = match(r) !== "new";
          return (
            <li key={r.id} className="grid gap-5 rounded-card border border-border/60 bg-surface p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold break-words">{r.company_name ?? r.contact_name}</h2>
                  <StatusPill tone={existing ? "neutral" : "warning"}>{existing ? "Known customer" : "New customer"}</StatusPill>
                </div>
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <dt className="text-muted">Wants it</dt>
                  <dd className="font-semibold">
                    {formatDate(r.requested_date)}{r.size_yards ? ` · ${r.size_yards}-yard` : ""}
                  </dd>
                  <dt className="text-muted">Where</dt>
                  <dd className="break-words">
                    {r.address}
                    {r.lat == null && <span className="block text-warn">Not found on the map. Check the address before the driver goes.</span>}
                  </dd>
                  <dt className="text-muted">Contact</dt>
                  <dd className="break-words">
                    {r.company_name && <>{r.contact_name} · </>}
                    <a className="underline" href={`tel:${r.phone}`}>{formatPhone(r.phone)}</a>
                    {r.email && <> · {r.email}</>}
                  </dd>
                  {r.notes && (
                    <>
                      <dt className="text-muted">Their note</dt>
                      <dd className="break-words">“{r.notes}”</dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="space-y-3">
                <form action={approveRequest} className="space-y-3">
                  <input type="hidden" name="requestId" value={r.id} />
                  <Field label="Customer">
                    <select name="customerId" defaultValue={match(r)} className="input">
                      <option value="new">New customer: {r.company_name ?? r.contact_name}</option>
                      {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Drop day">
                      <input type="date" name="dropDate" defaultValue={r.requested_date} className="input" />
                    </Field>
                    <Field label="Driver">
                      <select name="driverId" className="input" defaultValue={people.find((p) => p.role === "driver")?.userId ?? ""}>
                        <option value="">Assign later</option>
                        {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Submit className="btn w-full" pendingLabel="Approving…">Approve and text the customer</Submit>
                </form>
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted">Decline this request</summary>
                  <form action={declineRequest} className="space-y-2 pt-1">
                    <input type="hidden" name="requestId" value={r.id} />
                    <Field label="Reason" hint="Kept inside the office. Declining sends the customer nothing.">
                      <input name="reason" className="input" />
                    </Field>
                    <Submit pendingLabel="Declining…">Decline</Submit>
                  </form>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
