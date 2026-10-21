import { approveRequest, declineRequest } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { assignable, loadTeam } from "@/lib/office/team";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function RequestsPage({ searchParams }: PageProps<"/office/requests">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: requests }, { data: customers }, team, { data: links }] = await Promise.all([
    supabase.from("rental_requests").select("*").eq("status", "pending").order("requested_date"),
    supabase.from("customers").select("id, name, phone, billing_email").eq("is_active", true).order("name"),
    loadTeam(supabase),
    supabase.from("request_links").select("slug").eq("is_active", true),
  ]);
  const people = assignable(team);

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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">Dumpster requests</h1>
        {links?.[0] && (
          <p className="text-sm text-muted">
            Customer link: <code>{process.env.APP_URL ?? ""}/request/{links[0].slug}</code>
          </p>
        )}
      </div>
      {(requests ?? []).length === 0 && <p className="card text-muted">No requests waiting.</p>}

      {(requests ?? []).map((r) => (
        <section key={r.id} className="card grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="text-base font-semibold">{r.company_name ?? r.contact_name}</p>
            {r.company_name && <p>{r.contact_name}</p>}
            <p><a className="underline" href={`tel:${r.phone}`}>{formatPhone(r.phone)}</a>{r.email && <> · {r.email}</>}</p>
            <p>{r.address}{r.lat == null && <span className="ml-1 text-warn">(not found on map)</span>}</p>
            <p>
              Wants it <strong>{formatDate(r.requested_date)}</strong>
              {r.size_yards && <> · {r.size_yards} yard</>}
            </p>
            {r.notes && <p className="text-muted">“{r.notes}”</p>}
          </div>
          <div className="space-y-3">
            <form action={approveRequest} className="space-y-2">
              <input type="hidden" name="requestId" value={r.id} />
              <label className="label">
                <span>Customer</span>
                <select name="customerId" defaultValue={match(r)} className="input">
                  <option value="new">New customer: {r.company_name ?? r.contact_name}</option>
                  {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="label">
                  <span>Drop date</span>
                  <input type="date" name="dropDate" defaultValue={r.requested_date} className="input" />
                </label>
                <label className="label">
                  <span>Driver</span>
                  <select name="driverId" className="input" defaultValue={people.find((p) => p.role === "driver")?.userId ?? ""}>
                    <option value="">Assign later</option>
                    {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                  </select>
                </label>
              </div>
              <button className="btn w-full">Approve and text the customer</button>
            </form>
            <form action={declineRequest} className="flex gap-2">
              <input type="hidden" name="requestId" value={r.id} />
              <input name="reason" placeholder="Reason (internal)" className="input" />
              <button className="btn-secondary">Decline</button>
            </form>
          </div>
        </section>
      ))}
    </>
  );
}
