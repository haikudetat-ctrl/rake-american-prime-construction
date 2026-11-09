import type { ReactNode } from "react";
import { Callout } from "./callout";

/**
 * The three "nothing to show yet" states are different facts and look different
 * (Figma 7, 8 and 88). Never render a failed read as an empty list or a zero total.
 */

/** Still loading. Motion stops for people who ask for reduced motion. */
export function Skeleton({ rows = 3, label = "Loading your work…" }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="rounded-row border border-border/60 bg-surface p-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-sunken motion-reduce:animate-none" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-sunken motion-reduce:animate-none" />
        </div>
      ))}
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

/** Loaded, and there is genuinely nothing here. A quiet queue, not an error. */
export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-card border border-dashed border-border px-4 py-6 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <p className="text-sm text-muted">{children}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/** The read failed. Say so, keep the rest of the page usable, and do not guess numbers. */
export function Unavailable({ area, children }: { area: ReactNode; children?: ReactNode }) {
  return (
    <Callout tone="danger" title={<>{area} is unavailable</>}>
      {children ?? "We couldn't load this. Reload to try again; if it keeps happening, ask an owner to check the connection."}{" "}
      <span className="block pt-1 opacity-90">Nothing here is shown as zero or empty until it loads.</span>
    </Callout>
  );
}
