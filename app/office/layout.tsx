import Link from "next/link";
import { LocalNav, Sidebar, TabBar } from "./_nav";
import { requireStaff } from "@/lib/auth";
import type { NavBadges } from "@/lib/office/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const member = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const [pending, newLeads, unread, { data: priceBook }] = await Promise.all([
    supabase.from("rental_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "new"),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").is("read_at", null),
    supabase.from("price_books").select("needs_confirmation").eq("is_active", true).maybeSingle(),
  ]);
  // A failed count shows no badge rather than a misleading zero.
  const badges: NavBadges = {
    requests: pending.error ? null : pending.count,
    leads: newLeads.error ? null : newLeads.count,
    inbox: unread.error ? null : unread.count,
  };
  const role = member.role === "owner" ? "owner" : "office";

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <Sidebar badges={badges} name={member.name} role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        {priceBook?.needs_confirmation && (
          <div className="border-b border-warn/30 bg-warn-soft px-4 py-2 text-center text-sm text-warn">
            Prices are placeholders until confirmed.{" "}
            {member.role === "owner" ? (
              <Link href="/office/settings" className="font-semibold underline">Set the delivery fee and extended charge</Link>
            ) : (
              "Ask an owner to set them in Settings."
            )}
          </div>
        )}
        {/* Bottom padding clears the phone tab bar and the home indicator. */}
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8">
          <LocalNav badges={badges} />
          {children}
        </main>
      </div>
      <TabBar badges={badges} />
    </div>
  );
}
