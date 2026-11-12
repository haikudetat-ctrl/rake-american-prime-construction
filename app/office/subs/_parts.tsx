import { formatCents } from "@/lib/money";
import { describeTiers, type PitchTier } from "@/lib/subcontract/tiers";

export type Worker = { id: string; name: string };

/** Who worked the job: big tap targets, two across on a phone. */
export function CrewPicker({ workers, selected = [] }: { workers: Worker[]; selected?: string[] }) {
  if (workers.length === 0) {
    return <p className="text-sm text-muted">Add your crew in Setup first.</p>;
  }
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Crew</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {workers.map((w) => (
          <label key={w.id} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-sunken">
            <input type="checkbox" name="workerId" value={w.id} defaultChecked={selected.includes(w.id)} className="h-4 w-4" />
            <span>{w.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "$120.00 a square, +$15.00 a square at 9-10/12, +$20.00 a square at 11/12 and up, $1,400.00 minimum". */
export function rateText(centsPerSq: number, tiers: PitchTier[], minimumCents?: number | null): string {
  const parts = [`${formatCents(centsPerSq)} a square`];
  const pitch = describeTiers(tiers);
  if (pitch) parts.push(pitch);
  if (minimumCents) parts.push(`${formatCents(minimumCents)} minimum a roof`);
  return parts.join(", ");
}

export const STATUS_LABEL: Record<string, string> = { scheduled: "Work scheduled", done: "Work complete", void: "Cancelled" };
