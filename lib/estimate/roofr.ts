/**
 * Reads a Roofr measurement report's text into our measurements. Pure, for
 * tests; the PDF-to-text step is in roofr-pdf.ts.
 *
 * Area, pitch and the area lines follow the reader in 2stack-roof-quote (built
 * against Roofr's report layout). Edge lengths (eaves, rakes, …) are read from
 * lines like "Eaves 152ft 4in" or "Eaves: 152 ft" — NOT yet checked against a
 * real report from Andrey; anything not found is left for him to type.
 */

export type ParsedRoofr = {
  squares: number | null;
  pitch: number | null;
  facets: number | null;
  twoLayerSquares: number | null;
  twoStorySquares: number | null;
  eaves: number | null;
  rakes: number | null;
  ridges: number | null;
  hips: number | null;
  valleys: number | null;
  step_flashing: number | null;
  wall_flashing: number | null;
  found: string[];
};

const num = (s: string | undefined) => (s === undefined ? null : Number(s.replace(/,/g, "")));
const round2 = (n: number) => Math.round(n * 100) / 100;

function feet(text: string, label: string): number | null {
  const m = new RegExp(`\\b${label}\\s*:?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:ft|')\\s*(?:(\\d{1,2})\\s*(?:in|"))?`, "i").exec(text);
  if (!m) return null;
  const ft = num(m[1])!;
  const inches = m[2] ? Number(m[2]) : 0;
  return round2(ft + inches / 12);
}

export function parseRoofrText(text: string): ParsedRoofr {
  const area = num(/Total roof area:?\s*([\d,]+(?:\.\d+)?)\s*sq\s*ft/i.exec(text)?.[1] ?? /Total roof area:?\s*([\d,]+(?:\.\d+)?)\s*sqft/i.exec(text)?.[1]);
  const pitch = num(/Predominant pitch:?\s*(\d{1,2})\s*\/\s*12/i.exec(text)?.[1]);
  const facets = num(/Total roof facets:?\s*(\d+)/i.exec(text)?.[1]);
  const twoLayer = num(/Two layer area:?\s*([\d,]+)\s*sq\s*ft/i.exec(text)?.[1] ?? /Two layer area:?\s*([\d,]+)\s*sqft/i.exec(text)?.[1]);
  const twoStory = num(/Two story area:?\s*([\d,]+)\s*sq\s*ft/i.exec(text)?.[1] ?? /Two story area:?\s*([\d,]+)\s*sqft/i.exec(text)?.[1]);

  const parsed: ParsedRoofr = {
    squares: area === null ? null : round2(area / 100),
    pitch,
    facets,
    twoLayerSquares: twoLayer === null ? null : round2(twoLayer / 100),
    twoStorySquares: twoStory === null ? null : round2(twoStory / 100),
    eaves: feet(text, "Eaves?"),
    rakes: feet(text, "Rakes?"),
    ridges: feet(text, "Ridges?"),
    hips: feet(text, "Hips?"),
    valleys: feet(text, "Valleys?"),
    step_flashing: feet(text, "Step flashing"),
    wall_flashing: feet(text, "(?:Wall|Headwall|Apron) flashing"),
    found: [],
  };
  parsed.found = (Object.keys(parsed) as (keyof ParsedRoofr)[]).filter((k) => k !== "found" && parsed[k] !== null);
  return parsed;
}
