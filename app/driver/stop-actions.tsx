"use client";

import { useState, useTransition } from "react";
import { completeStop, recordTicket, type ActionResult } from "@/app/driver/actions";
import { shrinkPhoto as shrink } from "@/lib/images/shrink";
import type { MessageKey } from "@/lib/i18n";

type T = Record<MessageKey, string>;

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error);
    });
  return { pending, error, run };
}

export function DropAction({ stopId, cans, t }: { stopId: string; cans: { id: string; label: string; size: number }[]; t: T }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="space-y-2"
      action={(form) => run(() => completeStop(form))}
    >
      <input type="hidden" name="stopId" value={stopId} />
      <label className="label">
        <span>{t["driver.chooseCan"]}</span>
        <select name="canId" required className="input py-3" defaultValue="">
          <option value="" disabled>—</option>
          {cans.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.size} yd</option>)}
        </select>
      </label>
      <button disabled={pending} className="btn w-full py-4 text-lg">{t["driver.dropped"]}</button>
      {error && <p className="text-sm text-danger">{t["driver.error"]} ({error})</p>}
    </form>
  );
}

export function PickupAction({ stopId, t }: { stopId: string; t: T }) {
  const { pending, error, run } = useAction();
  return (
    <form action={(form) => run(() => completeStop(form))}>
      <input type="hidden" name="stopId" value={stopId} />
      <button disabled={pending} className="btn w-full py-4 text-lg">{t["driver.pickedUp"]}</button>
      {error && <p className="mt-2 text-sm text-danger">{t["driver.error"]} ({error})</p>}
    </form>
  );
}

export function TicketAction({
  stopId,
  date,
  landfills,
  t,
}: {
  stopId: string;
  date: string;
  landfills: { id: string; name: string }[];
  t: T;
}) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="space-y-3"
      action={(form) =>
        run(async () => {
          const photo = form.get("photo");
          if (photo instanceof File && photo.size > 0) form.set("photo", await shrink(photo));
          return recordTicket(form);
        })
      }
    >
      <input type="hidden" name="stopId" value={stopId} />
      <input type="hidden" name="date" value={date} />
      <label className="label">
        <span>{t["driver.ticketPhoto"]}</span>
        <input name="photo" type="file" accept="image/*" capture="environment" className="input" />
      </label>
      <label className="label">
        <span>{t["driver.landfill"]}</span>
        <select name="landfillId" className="input py-3" defaultValue={landfills[0]?.id ?? ""}>
          {landfills.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          <span>{t["driver.tons"]}</span>
          <input name="tons" required inputMode="decimal" className="input py-3 text-lg" />
        </label>
        <label className="label">
          <span>{t["driver.fee"]}</span>
          <input name="fee" required inputMode="decimal" className="input py-3 text-lg" />
        </label>
      </div>
      <label className="label">
        <span>{t["driver.ticketNumber"]}</span>
        <input name="ticketNumber" className="input" />
      </label>
      <button disabled={pending} className="btn w-full py-4 text-lg">{t["driver.saveTicket"]}</button>
      {error && <p className="text-sm text-danger">{t["driver.error"]} ({error})</p>}
    </form>
  );
}
