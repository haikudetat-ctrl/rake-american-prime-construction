"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import type { IntakeFailure } from "@/lib/intake/messages";

/**
 * Submits a public request form (dumpster, roofing, referral).
 *
 * These forms used to pass a server action straight to `<form action>`.
 * That had two costs on a phone:
 * - React resets a form after its action runs, and the error path redirected
 *   back to the page, so one rejected submit wiped every field, including the
 *   text-consent box.
 * - Nothing stopped a second tap while the first was in flight, so a double
 *   tap booked two dumpsters.
 *
 * Here the submit is handled by hand: the action returns what was wrong (or
 * redirects on success), the form keeps what was typed, and a submit while one
 * is already in flight is ignored.
 */
export function useIntakeSubmit(
  action: (form: FormData) => Promise<IntakeFailure | undefined | void>,
  /** Runs in the browser before sending (e.g. shrinking photos). Return a message to stop. */
  prepare?: (form: FormData) => Promise<string | null>,
) {
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<IntakeFailure | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // `pending` only flips on the next render; a fast double tap lands before that.
  const inFlight = useRef(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const form = new FormData(event.currentTarget);
    start(async () => {
      setFailure(null);
      setProblem(null);
      try {
        if (prepare) {
          const stop = await prepare(form);
          if (stop) {
            setProblem(stop);
            inFlight.current = false;
            return;
          }
        }
        const result = await action(form);
        // On success the action redirects and this page goes away; stay locked until it does.
        if (result) {
          setFailure(result);
          inFlight.current = false;
        }
      } catch (err) {
        inFlight.current = false;
        // Next redirects are control flow; let the router finish them. Other
        // transport failures stay in the form so the person can retry safely.
        const digest = err && typeof err === "object" && "digest" in err ? String(err.digest) : "";
        if (digest.startsWith("NEXT_REDIRECT;") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;")) throw err;
        setFailure({ error: "failed" });
      }
    });
  }

  return { pending, failure, problem, bad: failure?.fields ?? [], onSubmit };
}
