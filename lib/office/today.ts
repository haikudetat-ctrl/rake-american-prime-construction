import { companyToday, formatDate } from "@/lib/dates";
import { NEED_LABEL, type Need } from "@/lib/leads/schema";
import { formatCents } from "@/lib/money";

/**
 * Today's decision list (Figma V2 screens 05 to 08). Each queue is a question the office
 * already answers somewhere in the app; Today only gathers them, oldest first, so nothing
 * here is a new workflow. A queue that fails to load is reported as unavailable, never
 * as empty or zero.
 */

/** How many rows each queue shows before "See all". */
export const QUEUE_LIMIT = 5;
/** A sent proposal with no signature after this many days needs a follow-up call. */
export const PROPOSAL_FOLLOW_UP_DAYS = 3;

export type TodayItem = { key: string; href: string; title: string; detail: string; action: string };
export type TodayQueue = {
  id: string;
  label: string;
  href: string;
  /** Items waiting, or null when the queue could not load. */
  count: number | null;
  items: TodayItem[];
};

type Result<T> = { data: T[] | null; count?: number | null; error: unknown };
type Embed<T> = T | T[] | null | undefined;
function one<T>(value: Embed<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function waited(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** The company-calendar date of a timestamp. */
function dayOf(iso: string): string {
  return companyToday(new Date(iso));
}

function queue<T>(id: string, label: string, href: string, result: Result<T>, item: (row: T) => TodayItem): TodayQueue {
  if (result.error || !result.data) return { id, label, href, count: null, items: [] };
  const items = result.data.slice(0, QUEUE_LIMIT).map(item);
  return { id, label, href, count: Math.max(result.count ?? 0, result.data.length), items };
}

export type LeadRow = { id: string; name: string; address: string | null; area: string | null; need: string; created_at: string };
export type RequestRow = { id: string; contact_name: string; company_name: string | null; address: string; requested_date: string };
export type CloseoutRow = { id: string; address: string; work_date: string; sub_contractors: Embed<{ name: string }> };
export type ReadyInvoiceRow = { id: string; total_cents: number; customer_id: string; customers: Embed<{ name: string }> };
export type OverdueRow = {
  id: string; job_id: string; number: number; total_cents: number; due_on: string;
  sub_contractors: Embed<{ name: string }>;
  sub_payments?: { amount_cents: number; voided_at: string | null }[] | null;
};

/** What is still owed on a subcontract invoice: its total less payments that were not voided. */
export function balanceDue(i: Pick<OverdueRow, "total_cents" | "sub_payments">): number {
  return i.total_cents - (i.sub_payments ?? []).filter((p) => !p.voided_at).reduce((sum, p) => sum + p.amount_cents, 0);
}
export type ProposalRow = { id: string; number: number; sent_at: string; viewed_at: string | null; leads: Embed<{ name: string; address: string | null }> };

export function buildQueues(
  today: string,
  r: {
    leads: Result<LeadRow>;
    requests: Result<RequestRow>;
    closeout: Result<CloseoutRow>;
    ready: Result<ReadyInvoiceRow>;
    overdue: Result<OverdueRow>;
    proposals: Result<ProposalRow>;
  },
): TodayQueue[] {
  // Dumpster invoices are issued per customer on a statement, so they queue per customer.
  const ready: Result<{ customer: string; name: string; invoices: number; cents: number }> = r.ready.error || !r.ready.data
    ? { data: null, error: r.ready.error ?? true }
    : {
        error: null,
        data: [...r.ready.data.reduce((byCustomer, inv) => {
          const entry = byCustomer.get(inv.customer_id) ?? { customer: inv.customer_id, name: one(inv.customers)?.name ?? "Customer", invoices: 0, cents: 0 };
          entry.invoices += 1;
          entry.cents += inv.total_cents;
          return byCustomer.set(inv.customer_id, entry);
        }, new Map<string, { customer: string; name: string; invoices: number; cents: number }>()).values()],
      };

  return [
    queue("leads", "New roofing leads", "/office/leads", r.leads, (l) => ({
      key: l.id,
      href: `/office/leads/${l.id}`,
      title: [l.name, l.address ?? l.area].filter(Boolean).join(" · "),
      detail: `${NEED_LABEL[l.need as Need] ?? "New lead"} · waiting ${waited(daysBetween(dayOf(l.created_at), today))}`,
      action: "Contact",
    })),
    queue("requests", "Dumpster requests", "/office/requests", r.requests, (q) => ({
      key: q.id,
      href: "/office/requests",
      title: [q.contact_name, q.company_name].filter(Boolean).join(" · "),
      detail: `Wants a drop ${formatDate(q.requested_date)} · ${q.address}`,
      action: "Review request",
    })),
    queue("closeout", "Subcontract jobs to finish", "/office/subs", r.closeout, (j) => ({
      key: j.id,
      href: `/office/subs/${j.id}`,
      title: j.address,
      detail: `${one(j.sub_contractors)?.name ?? "Contractor"} · ${j.work_date === today ? "worked today" : `worked ${formatDate(j.work_date)}, not finished`}`,
      action: "Review & finish",
    })),
    queue("billing", "Dumpster invoices ready", "/office/billing", ready, (c) => ({
      key: c.customer,
      href: "/office/billing",
      title: c.name,
      detail: `${c.invoices === 1 ? "1 completed rental" : `${c.invoices} completed rentals`} ready · ${formatCents(c.cents)}`,
      action: "Review statement",
    })),
    queue("overdue", "Overdue subcontract invoices", "/office/subs/invoices?status=overdue", r.overdue, (i) => ({
      key: i.id,
      href: `/office/subs/${i.job_id}`,
      title: `${one(i.sub_contractors)?.name ?? "Contractor"} · invoice ${i.number}`,
      detail: `${formatCents(balanceDue(i))} due ${formatDate(i.due_on)} · ${waited(daysBetween(i.due_on, today))} overdue`,
      action: "Follow up",
    })),
    queue("proposals", "Proposals to follow up", "/office/leads", r.proposals, (p) => {
      const lead = one(p.leads);
      return {
        key: p.id,
        href: `/office/proposals/${p.id}`,
        title: [lead?.name ?? `Proposal ${p.number}`, lead?.address].filter(Boolean).join(" · "),
        detail: `Sent ${formatDate(dayOf(p.sent_at))} · ${p.viewed_at ? "opened, not signed" : "not opened yet"}`,
        action: "Follow up",
      };
    }),
  ];
}

/** "4 items need a next step", told honestly when some queues could not load. */
export function summarize(queues: TodayQueue[]): { waiting: number; unavailable: TodayQueue[] } {
  const unavailable = queues.filter((q) => q.count === null);
  const waiting = queues.reduce((sum, q) => sum + (q.count ?? 0), 0);
  return { waiting, unavailable };
}
