import { formatCents } from "@/lib/money";

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

/** "$95.00 a square, +$5.00 a square for each pitch step from 9/12". */
export function rateText(centsPerSq: number, pitchFrom: number, stepCents: number): string {
  const base = `${formatCents(centsPerSq)} a square`;
  return stepCents > 0 ? `${base}, +${formatCents(stepCents)} a square for each pitch step from ${pitchFrom}/12` : base;
}

export const STATUS_LABEL: Record<string, string> = { scheduled: "Open", done: "Closed", void: "Cancelled" };
