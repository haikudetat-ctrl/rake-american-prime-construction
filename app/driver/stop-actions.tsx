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

/** Shrinks each photo on the phone so a drop with two pictures stays well under the upload limit. */
async function shrinkPhotos(form: FormData) {
  const photos = form.getAll("photo").filter((p): p is File => p instanceof File && p.size > 0);
  form.delete("photo");
  for (const [i, photo] of photos.entries()) form.append("photo", await shrink(photo, `stop-${i + 1}.jpg`));
}

/**
 * The required photo, straight from the camera, plus an optional second one.
 * The browser won't submit without the first; the server and the database
 * check again.
 */
function StopPhotos({ label, hint, t }: { label: string; hint: string; t: T }) {
  return (
    <div className="space-y-2">
      <label className="label">
        <span>{label}</span>
        <input name="photo" type="file" accept="image/*" capture="environment" required className="input py-3" />
        <span className="text-xs font-normal text-muted">{hint}</span>
      </label>
      <label className="label">
        <span className="font-normal text-muted">{t["driver.extraPhoto"]}</span>
        <input name="photo" type="file" accept="image/*" capture="environment" className="input" />
      </label>
    </div>
  );
}

export function DropAction({
  stopId,
  date,
  cans,
  t,
}: {
  stopId: string;
  date: string;
  cans: { id: string; label: string; size: number }[];
  t: T;
}) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="space-y-2"
      action={(form) =>
        run(async () => {
          await shrinkPhotos(form);
          return completeStop(form);
        })
      }
    >
      <input type="hidden" name="stopId" value={stopId} />
      <input type="hidden" name="date" value={date} />
      <label className="label">
        <span>{t["driver.chooseCan"]}</span>
        <select name="canId" required className="input py-3" defaultValue="">
          <option value="" disabled>—</option>
          {cans.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.size} yd</option>)}
        </select>
      </label>
      <StopPhotos label={t["driver.dropPhoto"]} hint={t["driver.dropPhotoHint"]} t={t} />
      <button disabled={pending} className="btn w-full py-4 text-lg">{t["driver.dropped"]}</button>
      {error && <p className="text-sm text-danger">{t["driver.error"]} ({error})</p>}
    </form>
  );
}

export function PickupAction({ stopId, date, t }: { stopId: string; date: string; t: T }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="space-y-2"
      action={(form) =>
        run(async () => {
          await shrinkPhotos(form);
          return completeStop(form);
        })
      }
    >
      <input type="hidden" name="stopId" value={stopId} />
      <input type="hidden" name="date" value={date} />
      <StopPhotos label={t["driver.pickupPhoto"]} hint={t["driver.pickupPhotoHint"]} t={t} />
      <button disabled={pending} className="btn w-full py-4 text-lg">{t["driver.pickedUp"]}</button>
      {error && <p className="text-sm text-danger">{t["driver.error"]} ({error})</p>}
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
