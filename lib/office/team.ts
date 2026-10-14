import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth";

export type TeamMember = {
  userId: string;
  role: Role;
  isActive: boolean;
  name: string;
  phone: string | null;
};

/** Team members with names. Staff-only (RLS returns just yourself otherwise). */
export async function loadTeam(supabase: SupabaseClient): Promise<TeamMember[]> {
  const [{ data: memberships }, { data: profiles }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, is_active").order("created_at"),
    supabase.from("profiles").select("user_id, full_name, phone"),
  ]);
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return (memberships ?? []).map((m) => {
    const profile = byUser.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role as Role,
      isActive: m.is_active,
      name: profile?.full_name || "Unnamed",
      phone: profile?.phone ?? null,
    };
  });
}

/** People who can be put on a run: drivers first, then owners/office who drive. */
export function assignable(team: TeamMember[]): TeamMember[] {
  const order: Record<Role, number> = { driver: 0, owner: 1, office: 2, crew: 9 };
  return team.filter((m) => m.isActive && m.role !== "crew").sort((a, b) => order[a.role] - order[b.role]);
}

/** Supabase returns a to-one embed as an object or a one-element array depending on inference. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
