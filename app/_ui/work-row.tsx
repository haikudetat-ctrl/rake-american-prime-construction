import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/**
 * AP / Work row (Figma 6:783): one linked piece of work, its context, and where it goes.
 * Long addresses and names wrap rather than truncate. `action` names the next step: its
 * own line on phones, a column on wider screens. Keep money out of `detail` and `aside`
 * unless the viewer's role may see it; this component does not check roles.
 */
export function WorkRow({ href, title, detail, action, aside }: { href: string; title: ReactNode; detail?: ReactNode; action?: ReactNode; aside?: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-center gap-4 rounded-row border border-border/60 bg-surface px-4 py-3.5 hover:border-border sm:px-[18px]"
      >
        <span className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
          <span className="block text-sm font-semibold break-words sm:text-base">{title}</span>
          {detail ? <span className="mt-1 block text-xs break-words text-muted sm:mt-0 sm:text-sm">{detail}</span> : null}
          {action ? <span className="mt-1.5 block text-sm font-semibold text-accent sm:hidden">{action}</span> : null}
        </span>
        {action ? <span className="hidden shrink-0 text-sm font-semibold text-accent sm:block">{action}</span> : null}
        {aside ? <span className="shrink-0 text-sm">{aside}</span> : null}
        <Icon name="chevron-right" className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}

/** A list of WorkRows. `headings` adds the desktop column labels from the Figma tables. */
export function WorkList({ headings, label, children }: { headings?: [string, string]; label?: string; children: ReactNode }) {
  return (
    <div>
      {headings ? (
        <div aria-hidden="true" className="hidden gap-4 px-[18px] pb-2 text-xs font-semibold tracking-wide text-muted uppercase sm:grid sm:grid-cols-[15rem_1fr]">
          <span>{headings[0]}</span>
          <span>{headings[1]}</span>
        </div>
      ) : null}
      <ul aria-label={label} className="space-y-3">
        {children}
      </ul>
    </div>
  );
}
