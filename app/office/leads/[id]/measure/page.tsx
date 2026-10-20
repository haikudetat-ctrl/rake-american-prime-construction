import Link from "next/link";
import { notFound } from "next/navigation";
import { saveMeasurement } from "@/app/office/actions";
import { Notice } from "@/app/office/_notice";
import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const FIELDS: { key: string; label: string; step?: string; hint?: string }[] = [
  { key: "squares", label: "Roof area (squares)", step: "0.01", hint: "Without waste; waste is added per material" },
  { key: "pitch", label: "Predominant pitch (/12)", step: "0.5" },
  { key: "stories", label: "Stories", step: "1" },
  { key: "layers", label: "Layers to tear off", step: "1" },
  { key: "eaves", label: "Eaves (ft)", step: "0.01" },
  { key: "rakes", label: "Rakes (ft)", step: "0.01" },
  { key: "ridges", label: "Ridges (ft)", step: "0.01" },
  { key: "hips", label: "Hips (ft)", step: "0.01" },
  { key: "valleys", label: "Valleys (ft)", step: "0.01" },
  { key: "step_flashing", label: "Step flashing (ft)", step: "0.01" },
  { key: "wall_flashing", label: "Wall flashing (ft)", step: "0.01" },
  { key: "deck_sheets", label: "Deck sheets to replace", step: "1" },
  { key: "pipe_boots", label: "Pipe boots", step: "1" },
  { key: "vents", label: "Vents", step: "1" },
  { key: "skylights", label: "Skylights", step: "1" },
  { key: "chimneys", label: "Chimneys", step: "1" },
];

export default async function MeasurePage({ params, searchParams }: PageProps<"/office/leads/[id]/measure">) {
  await requireStaff();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: lead } = await supabase.from("leads").select("id, name, address").eq("id", id).maybeSingle();
  if (!lead) notFound();
  const fromId = typeof query.m === "string" ? query.m : null;
  const { data: from } = fromId
    ? await supabase.from("measurements").select("*").eq("id", fromId).eq("lead_id", id).maybeSingle()
    : { data: null };
  const found: string[] = (from?.parsed as { found?: string[] } | null)?.found ?? [];

  return (
    <>
      <Notice searchParams={query} />
      <p className="text-sm"><Link className="underline" href={`/office/leads/${id}`}>← {lead.name}</Link></p>
      <h1 className="page-title">Measurements</h1>
      <p className="text-sm text-muted">{lead.address}</p>
      {from?.source === "roofr" && (
        <p className="card text-sm">
          From the Roofr report. Fields the report filled in are marked ✓; check them, and fill the counts the report doesn&apos;t
          have. Saving keeps the report attached.
        </p>
      )}
      <form action={saveMeasurement} className="card grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="leadId" value={id} />
        {from && <input type="hidden" name="fromId" value={from.id} />}
        {FIELDS.map((f) => (
          <label key={f.key} className="label">
            <span>{f.label}{found.includes(f.key) && <span className="text-ok"> ✓</span>}</span>
            <input name={f.key} type="number" min={0} step={f.step} inputMode="decimal" className="input"
              defaultValue={from ? Number(from[f.key]) : f.key === "pitch" ? 6 : f.key === "stories" || f.key === "layers" ? 1 : ""} />
            {f.hint && <span className="text-xs text-muted">{f.hint}</span>}
          </label>
        ))}
        <button className="btn sm:col-span-4 sm:justify-self-start">Save and price it</button>
      </form>
    </>
  );
}
