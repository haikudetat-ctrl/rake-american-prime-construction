"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Callout } from "./callout";

/**
 * Review-then-commit for actions with side effects (Figma 36 Review & close job,
 * 87 Remove this record?). Lists what will happen, requires an acknowledgment, and
 * keeps the button disabled until it is ticked and while the action runs, so a double
 * tap cannot submit twice. Place inside a <form> whose action does the work; the
 * checkbox posts `name=yes` so the server can refuse a submission without it.
 */
export function ConsequenceReview({
  effects,
  acknowledgment,
  submitLabel,
  pendingLabel = "Working…",
  title = "When you confirm",
  name = "acknowledged",
}: {
  effects: ReactNode[];
  acknowledgment: ReactNode;
  submitLabel: ReactNode;
  pendingLabel?: ReactNode;
  title?: ReactNode;
  name?: string;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="space-y-3">
      <Callout tone="warning" title={title}>
        <ul className="list-disc space-y-1 pl-4">
          {effects.map((effect, i) => (
            <li key={i}>{effect}</li>
          ))}
        </ul>
      </Callout>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-row border border-border/60 bg-surface p-3 text-sm font-medium">
        <input type="checkbox" name={name} value="yes" required checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
        <span>{acknowledgment}</span>
      </label>
      <Submit ready={checked} label={submitLabel} pendingLabel={pendingLabel} />
    </div>
  );
}

function Submit({ ready, label, pendingLabel }: { ready: boolean; label: ReactNode; pendingLabel: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!ready || pending} className="btn w-full sm:w-auto">
      {pending ? pendingLabel : label}
    </button>
  );
}
