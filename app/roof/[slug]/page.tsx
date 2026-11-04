import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LeadForm } from "@/app/roof/[slug]/lead-form";
import type { IntakeFailure } from "@/lib/intake/messages";
import { loadRequestLink, newFormToken } from "@/lib/intake/submit";
import { NEEDS, type Need } from "@/lib/leads/schema";
import { loadGallery, submitLeadRequest } from "@/lib/leads/submit";
import { IntakeShell } from "@/app/_components/intake-shell";

export const metadata: Metadata = { title: "Roofing estimate" };

/** A website link can preselect the kind of work (?need=gutters); anything else is ignored. */
function needFrom(value: string | string[] | undefined): Need | undefined {
  return typeof value === "string" && (NEEDS as readonly string[]).includes(value) ? (value as Need) : undefined;
}

export default async function RoofRequestPage({ params, searchParams }: PageProps<"/roof/[slug]">) {
  const { slug } = await params;
  const defaultNeed = needFrom((await searchParams).need);
  const link = await loadRequestLink(slug, "roofing");
  if (!link) notFound();
  const gallery = await loadGallery(link.brandId);

  // Returns what was wrong instead of redirecting, so the form keeps what was typed (and the consent box).
  async function submit(formData: FormData): Promise<IntakeFailure | undefined> {
    "use server";
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
    const result = await submitLeadRequest(slug, formData, ip);
    if (result.ok) redirect(`/roof/${slug}/thanks`);
    if (result.error === "unknown_link") notFound();
    return { error: result.error, fields: result.fields };
  }

  return (
    <IntakeShell kind="roofing" title="Let’s take care of your roof." intro="Tell us what you need. We’ll arrange a visit and help you understand your options." phone={link.brandPhone}>
        <LeadForm action={submit} formToken={newFormToken()} defaultNeed={defaultNeed} />

        {gallery.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold">Recent jobs</h2>
            <div className="grid grid-cols-2 gap-2">
              {gallery.map((photo) => (
                <figure key={photo.url} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs; no image optimizer configured. */}
                  <img src={photo.url} alt={photo.caption ?? "A roof we finished"} loading="lazy"
                    className="aspect-[4/3] w-full rounded-md object-cover" />
                  {photo.caption && <figcaption className="text-xs text-muted">{photo.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}
    </IntakeShell>
  );
}
