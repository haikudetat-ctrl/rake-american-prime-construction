import type { SupabaseClient } from "@supabase/supabase-js";

export type Thread = {
  phone: string;
  name: string | null;
  leadId: string | null;
  customerId: string | null;
  lastBody: string;
  lastAt: string;
  lastDirection: "in" | "out";
  unread: number;
};

type Row = {
  phone: string;
  body: string;
  direction: "in" | "out";
  read_at: string | null;
  created_at: string;
  lead_id: string | null;
  customer_id: string | null;
  leads: { name: string } | { name: string }[] | null;
  customers: { name: string } | { name: string }[] | null;
};

const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Groups recent texts into one thread per phone number, newest first. Pure, for tests. */
export function groupThreads(rows: Row[]): Thread[] {
  const threads = new Map<string, Thread>();
  for (const row of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    let thread = threads.get(row.phone);
    if (!thread) {
      thread = {
        phone: row.phone,
        name: first(row.leads)?.name ?? first(row.customers)?.name ?? null,
        leadId: row.lead_id,
        customerId: row.customer_id,
        lastBody: row.body,
        lastAt: row.created_at,
        lastDirection: row.direction,
        unread: 0,
      };
      threads.set(row.phone, thread);
    }
    thread.name ??= first(row.leads)?.name ?? first(row.customers)?.name ?? null;
    thread.leadId ??= row.lead_id;
    thread.customerId ??= row.customer_id;
    if (row.direction === "in" && !row.read_at) thread.unread++;
  }
  return [...threads.values()];
}

export async function loadThreads(supabase: SupabaseClient): Promise<Thread[]> {
  const { data } = await supabase
    .from("messages")
    .select("phone, body, direction, read_at, created_at, lead_id, customer_id, leads(name), customers(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  return groupThreads((data ?? []) as Row[]);
}
