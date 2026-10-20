import { addPlace, addTeamMember, publishPriceBook, setMemberActive, updateBrand } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { GalleryCard } from "@/app/office/settings/gallery-card";
import { QuickBooksCard } from "@/app/office/settings/quickbooks-card";
import { requireStaff } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { loadTeam, one } from "@/lib/office/team";
import { formatPhone } from "@/lib/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ROLE_LABEL = { owner: "Owner", office: "Office", driver: "Driver", crew: "Crew" } as const;

export default async function SettingsPage({ searchParams }: PageProps<"/office/settings">) {
  const member = await requireStaff();
  const isOwner = member.role === "owner";
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: priceBook }, { data: brands }, team, { data: yards }, { data: landfills }, { data: links }, { data: gallery }] =
    await Promise.all([
      supabase.from("price_books").select("*").eq("is_active", true).maybeSingle(),
      supabase.from("brands").select("*").order("kind"),
      loadTeam(supabase),
      supabase.from("yards").select("id, name, address, lat").order("created_at"),
      supabase.from("landfills").select("id, name, address, lat").order("created_at"),
      supabase.from("request_links").select("slug, is_active, brands(kind)"),
      supabase.from("gallery_photos").select("id, path, caption").order("sort").order("created_at"),
    ]);

  return (
    <>
      <Notice searchParams={params} />
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card space-y-3">
        <h2 className="font-semibold">Dumpster prices</h2>
        {priceBook && (
          <p className="text-sm">
            Version {priceBook.version}: {formatCents(priceBook.delivery_fee_cents)} delivery, then{" "}
            {formatCents(priceBook.extended_fee_cents_per_day)} a day after {priceBook.extended_after_days} days.
            Disposal is billed at the landfill cost.
            {priceBook.needs_confirmation && <strong className="text-warn"> These are placeholders.</strong>}
          </p>
        )}
        {isOwner ? (
          <form action={publishPriceBook} className="grid gap-2 sm:grid-cols-4 sm:items-end">
            <label className="label"><span>Delivery fee ($)</span>
              <input name="deliveryFee" required inputMode="decimal" className="input"
                defaultValue={priceBook ? (priceBook.delivery_fee_cents / 100).toFixed(2) : ""} />
            </label>
            <label className="label"><span>Included days</span>
              <input name="extendedAfterDays" type="number" min={0} required className="input" defaultValue={priceBook?.extended_after_days ?? 7} />
            </label>
            <label className="label"><span>Per extra day ($)</span>
              <input name="extendedFeePerDay" inputMode="decimal" className="input"
                defaultValue={priceBook ? (priceBook.extended_fee_cents_per_day / 100).toFixed(2) : "0"} />
            </label>
            <button className="btn">Publish new prices</button>
            <p className="text-xs text-muted sm:col-span-4">
              Rentals already booked keep the prices they were booked at.
            </p>
          </form>
        ) : (
          <p className="text-sm text-muted">Only an owner can change prices.</p>
        )}
      </section>

      {isOwner && <QuickBooksCard companyId={member.companyId} />}

      <section className="card space-y-3">
        <h2 className="font-semibold">Customer links</h2>
        {(links ?? []).map((l) => {
          const roofing = one(l.brands)?.kind === "roofing";
          return (
            <div key={l.slug} className="text-sm">
              <p className="font-medium">{roofing ? "Roofing estimate" : "Dumpster request"} {l.is_active ? "" : "(off)"}</p>
              <code>{process.env.APP_URL ?? ""}/{roofing ? "roof" : "request"}/{l.slug}</code>
            </div>
          );
        })}
        <p className="text-xs text-muted">
          Text these to customers. Dumpster requests land on Requests for approval; roofing requests land on Leads.
        </p>
      </section>

      {isOwner && <GalleryCard photos={gallery} />}

      <section className="card space-y-3">
        <h2 className="font-semibold">Team</h2>
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th></th></tr></thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.userId} className={m.isActive ? "" : "opacity-50"}>
                <td>{m.name}</td>
                <td>{ROLE_LABEL[m.role]}</td>
                <td>{formatPhone(m.phone)}</td>
                <td>
                  {isOwner && m.userId !== member.userId && (
                    <form action={setMemberActive}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <input type="hidden" name="active" value={m.isActive ? "0" : "1"} />
                      <button className="text-sm underline">{m.isActive ? "Remove access" : "Restore access"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isOwner && (
          <form action={addTeamMember} className="grid gap-2 sm:grid-cols-5 sm:items-end">
            <label className="label"><span>Name</span><input name="name" required className="input" /></label>
            <label className="label"><span>Role</span>
              <select name="role" className="input" defaultValue="driver">
                <option value="driver">Driver</option><option value="office">Office</option><option value="owner">Owner</option>
              </select>
            </label>
            <label className="label"><span>Mobile</span><input name="phone" type="tel" className="input" /></label>
            <label className="label"><span>Email</span><input name="email" type="email" className="input" /></label>
            <button className="btn">Add</button>
            <p className="text-xs text-muted sm:col-span-5">
              Drivers sign in with a code texted to their mobile. Owners and office sign in with an emailed link.
              Add a mobile for anyone who should get a text when a request comes in.
            </p>
          </form>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {[
          { kind: "yard", title: "Yards", rows: yards ?? [] },
          { kind: "landfill", title: "Landfills", rows: landfills ?? [] },
        ].map((group) => (
          <section key={group.kind} className="card space-y-3">
            <h2 className="font-semibold">{group.title}</h2>
            <ul className="space-y-1 text-sm">
              {group.rows.map((row) => (
                <li key={row.id}>
                  {row.name}
                  {row.address ? <span className="text-muted"> · {row.address}</span> : <span className="text-warn"> · no address</span>}
                </li>
              ))}
            </ul>
            <form action={addPlace} className="grid gap-2">
              <input type="hidden" name="kind" value={group.kind} />
              <input name="name" required placeholder="Name" className="input" />
              <input name="address" placeholder="Address (used to order runs)" className="input" />
              <button className="btn-secondary justify-self-start">Add</button>
            </form>
          </section>
        ))}
      </div>

      {isOwner && (brands ?? []).map((brand) => (
        <section key={brand.id} className="card space-y-3">
          <h2 className="font-semibold">{brand.kind === "dumpster" ? "Dumpster" : "Roofing"} business name</h2>
          <form action={updateBrand} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="brandId" value={brand.id} />
            <label className="label"><span>Name on invoices</span><input name="displayName" required defaultValue={brand.display_name} className="input" /></label>
            <label className="label"><span>Phone</span><input name="phone" defaultValue={brand.phone ?? ""} className="input" /></label>
            <label className="label"><span>Email</span><input name="email" type="email" defaultValue={brand.email ?? ""} className="input" /></label>
            <label className="label"><span>Mailing address (for checks)</span><input name="address" defaultValue={brand.address ?? ""} className="input" /></label>
            <button className="btn-secondary sm:col-span-2 sm:justify-self-start">Save</button>
          </form>
        </section>
      ))}
    </>
  );
}
