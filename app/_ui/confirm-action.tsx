"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ConsequenceReview } from "./consequence-review";
import { MoneyForm } from "./money-form";

/**
 * A void, cancel or issue button that opens its consequences first (Figma 87, 97 to 102).
 * Nothing is submitted until the person reads what will happen, gives a reason when one
 * is needed, and ticks the acknowledgment. The panel sits in place of the button, so it
 * works inside a table cell or a list row as well as on its own.
 */
export function ConfirmAction({
  action,
  trigger,
  triggerClassName = "btn-secondary",
  title,
  hidden = {},
  reason,
  effects,
  acknowledgment,
  submitLabel,
  pendingLabel,
  recheckHref,
}: {
  action: (form: FormData) => Promise<unknown>;
  trigger: ReactNode;
  triggerClassName?: string;
  title?: ReactNode;
  hidden?: Record<string, string>;
  reason?: { label: string; placeholder?: string; required?: boolean };
  effects: ReactNode[];
  acknowledgment: ReactNode;
  submitLabel: ReactNode;
  pendingLabel?: ReactNode;
  recheckHref: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const first = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (open) (first.current ?? heading.current)?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className={triggerClassName} aria-expanded="false" aria-controls={panel} onClick={() => setOpen(true)}>
        {trigger}
      </button>
    );
  }
  return (
    <div id={panel} className="space-y-3 rounded-card border border-border/60 bg-surface p-4 text-left">
      <p ref={heading} tabIndex={-1} className="font-semibold">{title ?? trigger}</p>
      <MoneyForm action={action} recheckHref={recheckHref} className="grid gap-3">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {reason && (
          <label className="label">
            <span>{reason.label}</span>
            <input ref={first} name="reason" required={reason.required ?? true} placeholder={reason.placeholder} className="input" />
          </label>
        )}
        <ConsequenceReview effects={effects} acknowledgment={acknowledgment} submitLabel={submitLabel} pendingLabel={pendingLabel} title="If you confirm" />
      </MoneyForm>
      <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => setOpen(false)}>
        Keep it as it is
      </button>
    </div>
  );
}
