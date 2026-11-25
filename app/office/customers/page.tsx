import Link from "next/link";
import { createCustomer } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { Unavailable } from "@/app/office/_unavailable";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Empty } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";
import { requireStaff } from "@/lib/auth";
import { searchTerm } from "@/lib/office/search";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Customers (Figma V2 56): who you bill, with the billing gaps that would stop a statement going out. */
export default async function CustomersPage({ searchParams }: PageProps<"/office/customers">) {
  await requireStaff();
  const params = await searchParams;
  const q = searchTerm(params.q);
  const supabase = await createSupabaseServerClient();
  let request = supabase
    .from("customers")
    .select("id, name, phone, billing_email, payment_terms_days, sites(count)")
    .eq("is_active", true)
    .order("name");
  if (q) {
    const digits = q.replace(/\D/g, "");
    request = request.or(digits.length >= 3 ? `name.ilike.%${q}%,phone.ilike.%${digits}%` : `name.ilike.%${q}%`);
  }
  const { data: customers, error } = await request;
  if (error) return <Unavailable eyebrow="Office · Customers" area="Customers" />;
  const rows = customers ?? [];
  const missing = rows.filter((c) => !c.billing_email?.trim()).length;

  return (
    <>
      <Notice searchParams={params} />
      <header className="space-y-1">
        <p className="eyebrow">Office · Customers</p>
        <h1 className="page-title">Customers</h1>
        <p className="text-muted">
          {q ? `${rows.length} matching “${q}”` : `${rows.length} active`}
          {missing ? ` · ${missing} without a billing email` : ""}
        </p>
      </header>

      <WithRail
        rail={
          <RailCard title="Add a customer">
            <form action={createCustomer} className="space-y-2">
              <label className="label"><span>Company</span><input name="name" required className="input" /></label>
              <label className="label"><span>Phone</span><input name="phone" type="tel" className="input" /></label>
              <label className="label"><span>Billing email</span><input name="billingEmail" type="email" className="input" /></label>
              <label className="label"><span>Terms (days)</span><input name="terms" type="number" min={0} defaultValue={15} className="input" /></label>
              <button className="btn w-full">Add customer</button>
            </form>
            <p className="text-xs text-muted">Without a billing email, statements still issue but you download and send them yourself.</p>
          </RailCard>
        }
      >
        <form role="search" className="flex gap-2" action="/office/customers">
          <label className="sr-only" htmlFor="customer-search">Search customers</label>
          <input id="customer-search" name="q" defaultValue={q} placeholder="Name or phone" className="input flex-1" />
          <button className="btn-secondary">Search</button>
          {q && <Link className="btn-secondary" href="/office/customers">Clear</Link>}
        </form>

        {rows.length === 0 ? (
          <Empty title={q ? "No customers match that search" : "No customers yet"}>
            {q ? "Try part of the name, or the last digits of the phone number." : "Add the first one with the form beside this list."}
          </Empty>
        ) : (
          <WorkList label="Customers" headings={["Customer", "Contact / billing"]}>
            {rows.map((c) => {
              const sites = (c.sites as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
              const email = c.billing_email?.trim();
              return (
                <WorkRow
                  key={c.id}
                  href={`/office/customers/${c.id}`}
                  title={c.name}
                  detail={[c.phone ? formatPhone(c.phone) : null, sites === 1 ? "1 job address" : `${sites} job addresses`, email ?? "no billing email", `${c.payment_terms_days}-day terms`].filter(Boolean).join(" · ")}
                  aside={email ? undefined : <StatusPill tone="warning">No email</StatusPill>}
                />
              );
            })}
          </WorkList>
        )}
      </WithRail>
    </>
  );
}
