"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { ESIGN_CONSENT, optionPrice, type ProposalAddon, type ProposalOption } from "@/lib/proposals/content";

/** Pick an option and add-ons, type your name, draw your signature, sign. */
export function SignForm({
  options,
  addons,
  contentHash,
  action,
}: {
  options: ProposalOption[];
  addons: ProposalAddon[];
  contentHash: string;
  action: (form: FormData) => Promise<void>;
}) {
  const [choice, setChoice] = useState<string>(options.length === 1 ? options[0].systemId : "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1c1a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const option = options.find((o) => o.systemId === choice);
  const total = (option ? optionPrice(option) : 0) + addons.filter((a) => picked.has(a.addonId)).reduce((s, a) => s + a.priceCents, 0);

  return (
    <form
      className="card space-y-4"
      action={(form) =>
        start(async () => {
          setError(null);
          if (!choice) return setError("Choose an option.");
          if (!hasInk) return setError("Draw your signature in the box.");
          form.set("systemId", choice);
          for (const id of picked) form.append("addonId", id);
          form.set("signature", canvas.current!.toDataURL("image/png"));
          await action(form);
        })
      }
    >
      <input type="hidden" name="contentHash" value={contentHash} />
      <h2 className="text-lg font-semibold">Accept and sign</h2>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Your option</legend>
        {options.map((o) => (
          <label key={o.systemId} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <span className="flex items-center gap-2">
              <input type="radio" name="choice" value={o.systemId} checked={choice === o.systemId} onChange={() => setChoice(o.systemId)} />
              <span>{o.name} <span className="text-xs text-muted">({o.tierLabel})</span></span>
            </span>
            <span className="font-semibold">{formatCents(optionPrice(o))}</span>
          </label>
        ))}
      </fieldset>

      {addons.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Add-ons (optional)</legend>
          {addons.map((a) => (
            <label key={a.addonId} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(a.addonId)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(a.addonId);
                    else next.delete(a.addonId);
                    setPicked(next);
                  }}
                />
                {a.name} ({a.qty} {a.unitLabel})
              </span>
              <span>{formatCents(a.priceCents)}</span>
            </label>
          ))}
        </fieldset>
      )}

      <p className="flex justify-between border-t border-border pt-2 text-lg font-semibold">
        <span>Total</span><span>{option ? formatCents(total) : "—"}</span>
      </p>

      <label className="label">
        <span>Your full name</span>
        <input name="signerName" required minLength={2} autoComplete="name" className="input" />
      </label>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-sm">
          <span>Sign here</span>
          <button type="button" onClick={clear} className="text-xs underline">Clear</button>
        </div>
        <canvas
          ref={canvas}
          className="h-36 w-full touch-none rounded-md border border-border bg-white"
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = e.currentTarget.getContext("2d")!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext("2d")!;
            const p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            setHasInk(true);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
      </div>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" name="esign" required className="mt-0.5" />
        <span>{ESIGN_CONSENT}</span>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button disabled={pending} className="btn w-full py-3 text-base">{pending ? "Signing…" : "Sign"}</button>
    </form>
  );
}
