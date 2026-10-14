import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NAV = [
  { href: "/office", label: "Today" },
  { href: "/office/requests", label: "Requests" },
  { href: "/office/cans", label: "Cans" },
  { href: "/office/customers", label: "Customers" },
  { href: "/office/billing", label: "Billing" },
  { href: "/office/numbers", label: "Numbers" },
  { href: "/office/settings", label: "Settings" },
] as const;

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const member = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const [{ count: pending }, { data: priceBook }] = await Promise.all([
    supabase.from("rental_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("price_books").select("needs_confirmation").eq("is_active", true).maybeSingle(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/office" className="font-semibold">American Prime</Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md px-2 py-1 whitespace-nowrap hover:bg-background">
                {item.label}
                {item.href === "/office/requests" && pending ? (
                  <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-accent-foreground">{pending}</span>
                ) : null}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Link href="/driver" className="hover:underline">Driver view</Link>
            <span>·</span>
            <span>{member.name}</span>
            <form action="/auth/signout" method="post">
              <button className="hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {priceBook?.needs_confirmation && (
        <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm">
          Prices are placeholders until confirmed.{" "}
          {member.role === "owner" ? (
            <Link href="/office/settings" className="underline">Set the delivery fee and extended charge</Link>
          ) : (
            "Ask an owner to set them in Settings."
          )}
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4">{children}</main>
    </div>
  );
}
