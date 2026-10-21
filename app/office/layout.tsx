import Link from "next/link";
import { BrandLogo } from "@/app/_components/brand";
import { OfficeNav, type NavItem } from "./_nav";
import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NAV = [
  { href: "/office", label: "Today" },
  { href: "/office/requests", label: "Dumpster Requests" },
  { href: "/office/leads", label: "Roofing Leads" },
  { href: "/office/inbox", label: "Inbox" },
  { href: "/office/jobs", label: "Jobs" },
  { href: "/office/stock", label: "Stock" },
  { href: "/office/referrals", label: "Referrals" },
  { href: "/office/cans", label: "Cans" },
  { href: "/office/customers", label: "Customers" },
  { href: "/office/billing", label: "Billing" },
  { href: "/office/numbers", label: "Numbers" },
  { href: "/office/settings", label: "Settings" },
] as const;

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const member = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const [{ count: pending }, { count: newLeads }, { count: unread }, { data: priceBook }] = await Promise.all([
    supabase.from("rental_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "new"),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").is("read_at", null),
    supabase.from("price_books").select("needs_confirmation").eq("is_active", true).maybeSingle(),
  ]);

  const items: NavItem[] = NAV.map((item) => ({
    ...item,
    badge:
      item.href === "/office/requests" ? pending : item.href === "/office/inbox" ? unread : item.href === "/office/leads" ? newLeads : null,
  }));

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside className="bg-ink text-ink-foreground lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 lg:block lg:px-4 lg:pt-6">
          <Link href="/office" className="block w-36 lg:w-full">
            <BrandLogo />
          </Link>
          <p className="hidden text-xs tracking-widest text-ink-muted uppercase lg:mt-3 lg:mb-5 lg:block">Roofing · Dumpsters</p>
          <form action="/auth/signout" method="post" className="lg:hidden">
            <button className="text-sm text-ink-muted hover:text-white hover:underline">Sign out</button>
          </form>
        </div>
        <div className="px-2 py-3 lg:flex-1 lg:px-3 lg:py-0">
          <OfficeNav items={items} />
        </div>
        <div className="hidden border-t border-ink-active px-4 py-4 text-sm text-ink-muted lg:block">
          <p className="font-medium text-ink-foreground">{member.name}</p>
          {/* A div, not a p: a form inside a <p> is invalid HTML and broke hydration on every office page. */}
          <div className="mt-1 flex gap-2">
            <Link href="/driver" className="hover:text-white hover:underline">Driver view</Link>
            <span aria-hidden="true">·</span>
            <form action="/auth/signout" method="post">
              <button className="hover:text-white hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
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
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-5 lg:px-8 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
