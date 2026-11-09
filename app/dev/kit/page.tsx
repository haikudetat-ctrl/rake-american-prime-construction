import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Callout } from "@/app/_ui/callout";
import { ConsequenceReview } from "@/app/_ui/consequence-review";
import { RailCard, WithRail } from "@/app/_ui/context-rail";
import { Field } from "@/app/_ui/field";
import { Icon, iconNames } from "@/app/_ui/icon";
import { Empty, Skeleton, Unavailable } from "@/app/_ui/states";
import { StatusPill } from "@/app/_ui/status-pill";
import { WorkList, WorkRow } from "@/app/_ui/work-row";

export const metadata: Metadata = { title: "UI kit", robots: { index: false, follow: false } };

const SWATCHES = ["background", "surface", "sunken", "foreground", "muted", "border", "accent", "ok", "ok-soft", "warn", "warn-soft", "danger", "danger-soft"];

/**
 * Every shared component and state on one page, with synthetic data, for design review
 * on previews and local builds. Production deploys return 404.
 */
export default function KitPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-6xl space-y-10 px-4 py-6 lg:px-8 lg:py-8">
      <header className="space-y-1">
        <p className="eyebrow">Synthetic data · not linked from the app</p>
        <h1 className="page-title">Everyday work UI kit</h1>
        <p className="text-muted">Tokens, type and components from the Figma V2 foundations.</p>
      </header>

      <section className="space-y-3">
        <h2>Tokens</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map((s) => (
            <div key={s} className="space-y-1.5">
              <div className="h-12 rounded-row border border-border/60" style={{ background: `var(--${s})` }} />
              <p className="text-xs text-muted">--{s}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2>Type and buttons</h2>
        <div className="card space-y-4">
          <p className="eyebrow">Office</p>
          <p className="page-title">Ready for billing</p>
          <p>Body text at 16px. Contractor A has 3 completed rentals ready for a statement.</p>
          <p className="text-sm text-muted">Muted 14px. Status labels describe evidence, not assumptions.</p>
          <p className="stat-value">$12,480.00</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn">Review statement</button>
            <button className="btn-secondary">Back to record</button>
            <button className="btn" disabled>Finish job &amp; queue invoice</button>
            <span className="pill">pill</span>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2>Work rows</h2>
        <WorkList headings={["Work / person", "Context / status"]} label="Ready for billing">
          <WorkRow href="#" title="Contractor A" detail="3 completed rentals ready · $1,580" />
          <WorkRow href="#" title="Jordan Reyes" detail="1 completed rental ready · $603" aside={<StatusPill tone="success">Ready</StatusPill>} />
          <WorkRow href="#" title="Blocked · missing ticket" detail="Rental 098 · driver follow-up" aside={<StatusPill tone="warning">Blocked</StatusPill>} />
          <WorkRow href="#" title="1427 Northwest Kings Highway Extension, Apartment 12B, Cherry Hill" detail="A 60-character address and a long context line should wrap onto a second line instead of being cut off mid-word." />
        </WorkList>
      </section>

      <section className="space-y-3">
        <h2>Fields</h2>
        <div className="card grid gap-4 sm:grid-cols-2">
          <Field label="Squares" hint="From the measurement report">
            <input className="input" inputMode="decimal" defaultValue="28" />
          </Field>
          <Field label="Billing email" error="Add a billing email before issuing the invoice.">
            <input className="input" type="email" aria-invalid="true" />
          </Field>
          <label className="label sm:col-span-2">
            <span>Existing form pattern</span>
            <select className="input" defaultValue="b">
              <option value="a">Standard</option>
              <option value="b">Enhanced</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h2>Status and callouts</h2>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="success">Role-scoped</StatusPill>
          <StatusPill tone="warning">Proposed</StatusPill>
          <StatusPill tone="danger">Overdue</StatusPill>
          <StatusPill>Draft</StatusPill>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Callout tone="warning" title="Outcome uncertain">The connection ended before confirmation. Check the record before trying again.</Callout>
          <Callout tone="success" title="Closeout recorded">Invoice SJ-1042 is queued for 15 minutes from now.</Callout>
          <Callout tone="danger" title="Message cannot be sent">This number has opted out of texts.</Callout>
          <Callout tone="neutral">Rental payments apply to statements in the current workflow.</Callout>
        </div>
      </section>

      <section className="space-y-3">
        <h2>Context rail and review</h2>
        <WithRail
          rail={
            <>
              <RailCard title="Next step">
                <p className="font-semibold">Finish job &amp; queue invoice</p>
                <p className="text-muted">Contractor A · job SJ-1042</p>
              </RailCard>
              <RailCard title="Delivery">
                <p>billing@example.com</p>
                <p className="text-muted">Email queues 15 minutes after closeout.</p>
              </RailCard>
            </>
          }
        >
          <div className="card space-y-1">
            <p className="text-xs font-semibold text-muted">Contractor invoice</p>
            <p className="font-medium">$3,400 = $3,080 roof + $320 decking</p>
          </div>
          <div className="card space-y-1">
            <p className="text-xs font-semibold text-muted">Crew earnings</p>
            <p className="font-medium">$1,500 = $1,400 roof + $100 decking</p>
          </div>
          <form action="/dev/kit">
            <ConsequenceReview
              effects={["Finishes the job and records crew earnings.", "Creates the contractor invoice and queues its email for 15 minutes later.", "Does not pay workers."]}
              acknowledgment="I reviewed the work, shares and billing recipient."
              submitLabel="Finish job & queue invoice"
            />
          </form>
        </WithRail>
      </section>

      <section className="space-y-3">
        <h2>States</h2>
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Skeleton />
          <Empty title="Nothing needs review">New closeouts and approvals will show up here.</Empty>
          <Unavailable area="Subcontracting" />
        </div>
      </section>

      <section className="space-y-3">
        <h2>Icons</h2>
        <div className="flex flex-wrap gap-4">
          {iconNames.map((n) => (
            <span key={n} className="flex items-center gap-2 text-sm text-muted">
              <Icon name={n} className="text-foreground" />
              {n}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
