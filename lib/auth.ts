import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLocale, type Locale } from "@/lib/i18n";

export type Role = "owner" | "office" | "driver" | "crew";

export type Member = {
  userId: string;
  companyId: string;
  role: Role;
  name: string;
  locale: Locale;
};

/** The signed-in member, or null. Cached per request. */
export const getMember = cache(async (): Promise<Member | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("company_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, locale").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!membership) return null;

  return {
    userId: user.id,
    companyId: membership.company_id,
    role: membership.role as Role,
    name: profile?.full_name || user.email || user.phone || "",
    locale: isLocale(profile?.locale) ? profile.locale : "en",
  };
});

export function isStaff(role: Role): boolean {
  return role === "owner" || role === "office";
}

export function homeFor(role: Role): "/office" | "/driver" | "/login" {
  if (isStaff(role)) return "/office";
  if (role === "driver") return "/driver";
  return "/login";
}

export async function requireStaff(): Promise<Member> {
  const member = await getMember();
  if (!member) redirect("/login");
  if (!isStaff(member.role)) redirect(homeFor(member.role));
  return member;
}

export async function requireOwner(): Promise<Member> {
  const member = await requireStaff();
  if (member.role !== "owner") redirect("/office");
  return member;
}

/** Drivers' screens. Staff may open them too (to cover a run). */
export async function requireDriver(): Promise<Member> {
  const member = await getMember();
  if (!member) redirect("/login/driver");
  if (member.role !== "driver" && !isStaff(member.role)) redirect("/login");
  return member;
}
