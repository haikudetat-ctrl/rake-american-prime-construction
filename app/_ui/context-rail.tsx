import type { ReactNode } from "react";

/**
 * Main column plus the Figma context rail (368px) on desktop; the rail stacks under the
 * work on phones. Use it only where the rail says something specific to this record:
 * closeout consequences, proposal timeline, rental status, a customer's balance.
 */
export function WithRail({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
      <div className="min-w-0 space-y-3">{children}</div>
      <aside className="space-y-4 lg:sticky lg:top-6">{rail}</aside>
    </div>
  );
}

export function RailCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-rail border border-border/60 bg-surface p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-sm">{children}</div>
    </section>
  );
}
