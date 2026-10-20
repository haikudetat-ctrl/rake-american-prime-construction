import Link from "next/link";
import { createCustomer } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CustomersPage({ searchParams }: PageProps<"/office/customers">) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone, billing_email, payment_terms_days")
    .eq("is_active", true)
    .order("name");

  return (
    <>
      <Notice searchParams={params} />
      <h1 className="page-title">Customers</h1>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Billing email</th><th>Terms</th></tr></thead>
          <tbody>
            {(customers ?? []).map((c) => (
              <tr key={c.id}>
                <td><Link className="underline" href={`/office/customers/${c.id}`}>{c.name}</Link></td>
                <td>{formatPhone(c.phone)}</td>
                <td>{c.billing_email ?? <span className="text-warn">missing</span>}</td>
                <td>{c.payment_terms_days} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2 className="mb-2 font-semibold">Add a customer</h2>
        <form action={createCustomer} className="grid gap-2 sm:grid-cols-5 sm:items-end">
          <label className="label sm:col-span-2"><span>Company</span><input name="name" required className="input" /></label>
          <label className="label"><span>Phone</span><input name="phone" type="tel" className="input" /></label>
          <label className="label"><span>Billing email</span><input name="billingEmail" type="email" className="input" /></label>
          <label className="label"><span>Terms (days)</span><input name="terms" type="number" min={0} defaultValue={15} className="input" /></label>
          <button className="btn sm:col-span-5 sm:justify-self-start">Add</button>
        </form>
      </section>
    </>
  );
}
