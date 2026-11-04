"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { intakeErrorText, type IntakeFailure } from "@/lib/intake/messages";
import { NEED_LABEL, type Need } from "@/lib/leads/schema";
import { toE164 } from "@/lib/phone";
import s from "./intake.module.css";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const Errors = createContext<Record<string, string>>({});
export function useIntakeErrors() { return useContext(Errors); }
const SERVER_ERRORS: Record<string, string> = {
  address: "Check the street address, or enter it by hand below.", town: "Enter the town for this address.", zip: "Enter a 5-digit ZIP code.",
  name: "Enter your full name (at least 2 characters).", contactName: "Enter your full name (at least 2 characters).",
  phone: "Enter a valid 10-digit US phone number.", email: "Check your email address, or leave it blank.",
  requestedDate: "Choose today or a later date.", need: "Choose the service you need.", notes: "Please shorten your project notes.",
};

export function FieldError({ name }: { name: string }) {
  const errors = useContext(Errors);
  return errors[name] ? <p className={s.error} id={`error-${name}`}>{errors[name]}</p> : null;
}

export function TextField({ label, hint, optional = false, ...props }: InputHTMLAttributes<HTMLInputElement> & {
  name: string; label: string; hint?: string; optional?: boolean;
}) {
  const errors = useContext(Errors);
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", errors[props.name] ? `error-${props.name}` : ""].filter(Boolean).join(" ");
  return <div className={s.field}>
    <label htmlFor={id}>{label}{optional && <span className={s.optional}>Optional</span>}</label>
    <input {...props} id={id} className="input" aria-invalid={errors[props.name] ? true : undefined} aria-describedby={describedBy || undefined} />
    {hint && <p id={`${id}-hint`} className={s.hint}>{hint}</p>}
    <FieldError name={props.name} />
  </div>;
}

export function ContactFields({ rental = false }: { rental?: boolean }) {
  return <>
    <TextField label="Your full name" name={rental ? "contactName" : "name"} required minLength={2} maxLength={120} autoComplete="name" />
    <TextField label="Mobile phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="(609) 555-0123" hint="So we can call or text about your request." />
    <TextField label="Email address" name="email" type="email" autoComplete="email" maxLength={200} optional hint={rental ? "Add an email if you’d like rental details and invoices by email." : "Another way for our team to reach you."} />
    {rental && <TextField label="Company name" name="companyName" autoComplete="organization" maxLength={160} optional />}
  </>;
}

function fieldName(input: Control) { return input.name || input.dataset.field || "address"; }
function check(input: Control) {
  if (input.name === "phone") input.setCustomValidity(input.value && !toE164(input.value) ? SERVER_ERRORS.phone : "");
  return input.checkValidity() ? null : SERVER_ERRORS[fieldName(input)] ?? input.validationMessage;
}

/** Both panels stay mounted: Back and server failures never reset address, photos or consent. */
export function IntakeWizard({ kind, formToken, project, contact, onSubmit, pending, failure, problem }: {
  kind: "roofing" | "dumpster"; formToken: string; project: ReactNode; contact: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; failure: IntakeFailure | null; problem: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [summary, setSummary] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [localFailure, setLocalFailure] = useState<IntakeFailure | null>(null);

  function focusStep(next: number, control?: Control) {
    setStep(next);
    requestAnimationFrame(() => {
      const target = control ?? formRef.current?.querySelector<HTMLHeadingElement>(`[data-panel="${next}"] h2`);
      target?.focus();
      target?.scrollIntoView({ block: "center", behavior: "instant" });
    });
  }

  const [seenFailure, setSeenFailure] = useState(failure);
  if (failure !== seenFailure) {
    setSeenFailure(failure);
    if (failure) {
      setErrors(Object.fromEntries((failure.fields ?? []).map(name => [name, SERVER_ERRORS[name] ?? "Check this detail and try again."])));
      setLocalFailure(failure);
      const projectFields = ["need", "address", "placeId", "town", "zip", "requestedDate", "sizeYards", "notes", "photos"];
      setStep((failure.fields ?? []).some(name => projectFields.includes(name)) ? 0 : 1);
    }
  }

  useEffect(() => {
    if (!failure) return;
    requestAnimationFrame(() => {
      const first = Array.from(formRef.current?.querySelectorAll<Control>("input,select,textarea") ?? []).find(input => (failure.fields ?? []).includes(fieldName(input)) && input.type !== "hidden");
      if (first) {
        first.closest("[data-panel]")?.querySelectorAll("details").forEach(detail => { if (detail.contains(first)) detail.open = true; });
        first.focus();
        first.scrollIntoView({ block: "center", behavior: "instant" });
      } else formRef.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
    });
  }, [failure]);

  useEffect(() => {
    if (problem) requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[role="alert"]')?.focus());
  }, [problem]);

  function validate(all: boolean) {
    const form = formRef.current;
    if (!form) return false;
    const controls = Array.from(form.querySelectorAll<Control>(all ? "input,select,textarea" : '[data-panel="0"] input,[data-panel="0"] select,[data-panel="0"] textarea')).filter(input => input.willValidate);
    const nextErrors: Record<string, string> = {};
    let first: Control | undefined;
    for (const input of controls) {
      const message = check(input);
      if (message) { nextErrors[fieldName(input)] = message; first ??= input; }
    }
    setErrors(nextErrors);
    setShowErrors(Boolean(first));
    if (first) {
      const panel = first.closest("[data-panel]");
      panel?.querySelectorAll("details").forEach(detail => { if (detail.contains(first!)) detail.open = true; });
      focusStep(panel?.getAttribute("data-panel") === "0" ? 0 : 1, first);
      return false;
    }
    return true;
  }

  function continueToContact() {
    if (!validate(false) || !formRef.current) return;
    const data = new FormData(formRef.current);
    const address = [data.get("address"), data.get("town"), data.get("zip")].filter(Boolean).join(", ");
    const detail = kind === "roofing" ? NEED_LABEL[data.get("need") as Need] : data.get("sizeYards") ? `${data.get("sizeYards")}-yard dumpster` : "We’ll help you choose a size";
    const date = data.get("requestedDate")?.toString();
    setSummary([detail, address, ...(date ? [`Preferred drop-off: ${new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`] : [])]);
    setLocalFailure(null);
    focusStep(1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending) { event.preventDefault(); return; }
    if (step === 0) { event.preventDefault(); continueToContact(); return; }
    if (!validate(true)) { event.preventDefault(); return; }
    setLocalFailure(null);
    onSubmit(event);
  }

  function clearError(event: FormEvent<HTMLFormElement>) {
    const input = event.target as Control;
    if (input.name === "phone") input.setCustomValidity("");
    const name = fieldName(input);
    if (errors[name]) setErrors(current => { const next = { ...current }; delete next[name]; return next; });
  }

  return <Errors.Provider value={errors}>
    <form ref={formRef} onSubmit={submit} onInput={clearError} noValidate method="post" className={s.form} aria-busy={pending}>
      <input type="hidden" name="formToken" value={formToken} />
      <div aria-hidden="true" className="absolute -left-[9999px]"><label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <ol className={s.progress} aria-label="Request progress">
        <li aria-current={step === 0 ? "step" : undefined}><span>{step ? "✓" : "1"}</span> Your project</li>
        <li aria-current={step === 1 ? "step" : undefined}><span>2</span> Contact & send</li>
      </ol>
      {localFailure && <p tabIndex={-1} role="alert" className={s.errorSummary}>{intakeErrorText(localFailure)} Your details are still here.</p>}
      {problem && <p tabIndex={-1} role="alert" className={s.errorSummary}>{problem}</p>}
      {showErrors && Object.keys(errors).length > 0 && <p role="alert" className={s.errorSummary}>Please check the highlighted details below.</p>}
      <fieldset disabled={pending} hidden={step !== 0} data-panel="0" className={s.panel}>
        <legend className="sr-only">Your project</legend>
        <h2 tabIndex={-1}>Tell us about your project.</h2>
        <p className={s.panelIntro}>Start with the basics. We&apos;ll work out the details together.</p>
        <div className={s.fields}>{project}</div>
        <div className={s.formButtons}><button type="button" onClick={continueToContact} className={s.primary}>Continue to contact details <span aria-hidden="true">→</span></button></div>
        <p className={s.privacy}>No account needed. Nothing is sent until you finish the next step.</p>
      </fieldset>
      <fieldset disabled={pending} hidden={step !== 1} data-panel="1" className={s.panel}>
        <legend className="sr-only">Contact and send</legend>
        <h2 tabIndex={-1}>How can we reach you?</h2>
        <p className={s.panelIntro}>Just your name and mobile number are required.</p>
        <div className={s.summary}><div>{summary.map((line,i)=><p key={i}>{i === 0 ? <strong>{line}</strong> : line}</p>)}</div><button type="button" onClick={()=>focusStep(0)}>Edit<span className="sr-only"> project details</span></button></div>
        <div className={s.fields}>{contact}</div>
        <div className={s.formButtons}><button type="button" onClick={()=>focusStep(0)} className={s.backButton}>Back</button><button type="submit" disabled={pending} className={s.primary}>{pending ? "Sending your request…" : "Request my estimate"}<span aria-hidden="true">{pending ? "…" : "↗"}</span></button></div>
        <p className={s.privacy}>{kind === "roofing" ? "We’ll follow up to arrange a visit. No work is booked by sending this form." : "This is a request, not a booking. We’ll confirm availability, pricing, and rental details with you."}</p>
      </fieldset>
    </form>
  </Errors.Provider>;
}
