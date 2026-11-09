"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Callout } from "./callout";

type Action = (form: FormData) => Promise<unknown>;

/**
 * Runs a server action and reports whether its outcome is unknown. Our money actions
 * always finish by redirecting back with a notice or an error, and Next rejects the
 * action's promise with that redirect, so it is rethrown for the router to follow.
 * Anything else (a dropped connection, a timeout, a deploy that retired the action)
 * means the request may or may not have reached the database.
 */
export async function runMoneyAction(action: Action, form: FormData): Promise<"done" | "uncertain"> {
  try {
    await action(form);
    return "done";
  } catch (error) {
    unstable_rethrow(error);
    return "uncertain";
  }
}

/** Figma 84, Outcome uncertain: send people to check the record, not to a retry button. */
export function OutcomeUncertain({ href, label = "Reload and check" }: { href: string; label?: string }) {
  return (
    <Callout tone="warning" role="alert" title="We couldn't confirm that went through">
      <p>The connection dropped before the app heard back, so it may or may not have been saved. Check before trying again.</p>
      {/* A full page load, so what shows is what the database has now. */}
      <a href={href} className="mt-1 inline-block font-semibold underline">{label}</a>
    </Callout>
  );
}

/**
 * A form for an action that moves money or can't be quietly repeated: closing a job,
 * issuing statements, recording or voiding a payment. On an uncertain outcome it
 * shows Figma 84 above the fields and locks them, so the person checks the record
 * instead of submitting again blind.
 */
export function MoneyForm({
  action,
  recheckHref,
  className,
  children,
}: {
  action: Action;
  /** Where to check whether it went through, usually the record's own page. */
  recheckHref: string;
  className?: string;
  children: ReactNode;
}) {
  const [uncertain, setUncertain] = useState(false);
  return (
    <form
      className={className}
      action={async (form) => {
        setUncertain(false);
        if ((await runMoneyAction(action, form)) === "uncertain") setUncertain(true);
      }}
    >
      {uncertain && (
        <div className="col-span-full">
          <OutcomeUncertain href={recheckHref} />
        </div>
      )}
      {/* Locked once the outcome is unknown: the way forward is to check, not to retry. */}
      <fieldset disabled={uncertain} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
