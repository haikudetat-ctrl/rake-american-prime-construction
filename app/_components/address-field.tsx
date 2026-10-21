"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

type Suggestion = { placeId: string; main: string; secondary: string; text: string };
type Picked = { placeId: string; text: string };

const MIN_CHARS = 3;
const DEBOUNCE_MS = 200;
const MUST_PICK = "Pick the address from the list, or tap “Address not listed?” to type it in.";

function newSession(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The address on the public request forms.
 *
 * Search mode (default): the person types, picks a Google suggestion, and the
 * form posts its place ID. Typing without picking blocks the submit, because
 * free text is how an address used to land in the wrong ZIP.
 *
 * Hand-typed mode: for a lot Google doesn't know yet (new construction) or
 * when search is down. Street, town and ZIP are all required, and the server
 * geocodes only inside that ZIP.
 *
 * Posts `placeId` + `address`, or `address` + `town` + `zip`
 * (see addressFields in lib/intake/schema.ts).
 */
export function AddressField({
  label,
  formToken,
  bad,
}: {
  label: string;
  formToken: string;
  bad: string[];
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useRef<string>("");
  const inflight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setMode] = useState<"search" | "manual">(
    bad.includes("town") || bad.includes("zip") ? "manual" : "search",
  );
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // What to pre-fill the street box with when switching to typing by hand.
  const [carry, setCarry] = useState("");

  const invalid = (name: string) => (bad.includes(name) ? "border-danger" : "");

  // The browser's own "fill this in" check stops a typed-but-not-picked submit.
  useEffect(() => {
    inputRef.current?.setCustomValidity(mode === "search" && text.trim() && !picked ? MUST_PICK : "");
  }, [mode, text, picked]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inflight.current?.abort();
    },
    [],
  );

  function switchToTyping(message: string | null, typed: string = picked ? "" : text) {
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    setOpen(false);
    setSuggestions([]);
    // Keep the street they started; town and ZIP get their own boxes.
    setCarry(typed.split(",")[0].trim());
    setNotice(message);
    setMode("manual");
  }

  async function search(q: string) {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    if (!session.current) session.current = newSession();
    try {
      const res = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, session: session.current, token: formToken }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        switchToTyping("Address search isn't working right now. Type the address in below.", q);
        return;
      }
      const body = (await res.json()) as { suggestions: Suggestion[] };
      setSuggestions(body.suggestions);
      setActive(body.suggestions.length ? 0 : -1);
      setSearched(true);
      setOpen(true);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      switchToTyping("Address search isn't working right now. Type the address in below.", q);
    }
  }

  function onType(value: string) {
    setText(value);
    setPicked(null);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < MIN_CHARS) {
      inflight.current?.abort();
      setSuggestions([]);
      setSearched(false);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => search(value.trim()), DEBOUNCE_MS);
  }

  async function choose(s: Suggestion) {
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    setOpen(false);
    setText(s.text);
    setPicked({ placeId: s.placeId, text: s.text });
    const usedSession = session.current;
    session.current = ""; // a pick ends Google's billing session
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: s.placeId, session: usedSession || newSession(), token: formToken }),
      });
      if (!res.ok) return; // the pick stands; the server looks it up again on submit
      const place = (await res.json()) as { placeId: string; address: string };
      // Show the full address with its ZIP, unless they've already changed it.
      setText((current) => (current === s.text ? place.address : current));
      setPicked((current) => (current?.placeId === s.placeId ? { placeId: s.placeId, text: place.address } : current));
    } catch {
      // Same as above: keep the pick.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // Enter picks a suggestion instead of sending a half-filled form.
      e.preventDefault();
      choose(suggestions[Math.max(active, 0)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (mode === "manual") {
    return (
      <fieldset className="space-y-3">
        <legend className="sr-only">{label}</legend>
        {notice && <p className="text-sm text-warn">{notice}</p>}
        <label className="label">
          <span>{label} (street and number)</span>
          <input name="address" required minLength={3} autoComplete="address-line1" defaultValue={carry}
            className={`input ${invalid("address")}`} placeholder="12 Ocean Ave" />
        </label>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <label className="label">
            <span>Town</span>
            <input name="town" required autoComplete="address-level2" className={`input ${invalid("town")}`} />
          </label>
          <label className="label">
            <span>ZIP</span>
            <input name="zip" required inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="postal-code"
              title="5-digit ZIP code" className={`input ${invalid("zip")}`} />
          </label>
        </div>
        {!notice && (
          <button type="button" className="text-sm text-accent underline"
            onClick={() => { setMode("search"); setText(""); setPicked(null); }}>
            Search for the address instead
          </button>
        )}
      </fieldset>
    );
  }

  const activeId = open && active >= 0 ? `${id}-opt-${active}` : undefined;
  const showMustPick = !open && text.trim().length >= MIN_CHARS && !picked;

  return (
    <div className="space-y-1 text-sm font-medium">
      <label htmlFor={id} className="block">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (suggestions.length && !picked) setOpen(true); }}
          onBlur={() => setOpen(false)}
          placeholder="Start typing the street address"
          className={`input ${picked ? "pr-9" : ""} ${invalid("address")}`}
        />
        {picked && (
          <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-ok">
            <path fill="currentColor" d="M7.6 13.4 4.2 10l-1.4 1.4 4.8 4.8 10-10-1.4-1.4z" />
          </svg>
        )}
        {open && (
          <ul id={listId} role="listbox" aria-label="Matching addresses"
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface font-normal shadow-lg">
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown would blur the input and close the list before the click lands
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer border-b border-border px-3 py-2.5 last:border-b-0 ${i === active ? "bg-sunken" : ""}`}
              >
                <span className="block text-foreground">{s.main}</span>
                {s.secondary && <span className="block text-xs text-muted">{s.secondary}</span>}
              </li>
            ))}
            {searched && suggestions.length === 0 && (
              <li className="px-3 py-2.5 text-muted">No match yet. Check the house number, or type it in by hand below.</li>
            )}
            <li aria-hidden="true" className="bg-sunken px-3 py-1 text-right text-[11px] text-muted">Google Maps</li>
          </ul>
        )}
      </div>
      <p id={`${id}-hint`} className={`text-xs font-normal ${showMustPick ? "text-danger" : "text-muted"}`}>
        {showMustPick
          ? "Pick your address from the list so we get the right ZIP."
          : picked
            ? <span className="text-foreground"><span className="text-ok">✓</span> {picked.text}</span>
            : "Pick it from the list as you type."}
      </p>
      <button type="button" className="text-xs font-normal text-accent underline"
        onClick={() => switchToTyping(null)}>
        Address not listed? Type it in
      </button>
      <input type="hidden" name="placeId" value={picked?.placeId ?? ""} />
      <input type="hidden" name="address" value={picked?.text ?? text} />
    </div>
  );
}
