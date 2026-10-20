import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Flash } from "@/app/_components/flash";
import { LeadForm } from "@/app/roof/[slug]/lead-form";
import { loadRequestLink, newFormToken } from "@/lib/intake/submit";
import { loadGallery, submitLeadRequest } from "@/lib/leads/submit";
import { formatPhone } from "@/lib/phone";
import { BrandBar } from "@/app/_components/brand";

export const metadata: Metadata = { title: "Roofing estimate" };

const ERRORS: Record<string, string> = {
  invalid: "Check the highlighted fields and try again.",
  rate_limited: "We've received several requests from you already. Call or text us instead.",
  failed: "Something went wrong on our end. Please call or text us.",
};

export default async function RoofRequestPage({ params, searchParams }: PageProps<"/roof/[slug]">) {
  const { slug } = await params;
  const { error, fields } = await searchParams;
  const link = await loadRequestLink(slug, "roofing");
  if (!link) notFound();
  const gallery = await loadGallery(link.brandId);

  async function submit(formData: FormData) {
    "use server";
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
    const result = await submitLeadRequest(slug, formData, ip);
    if (result.ok) redirect(`/roof/${slug}/thanks`);
    if (result.error === "unknown_link") notFound();
    const query = new URLSearchParams({ error: result.error });
    if (result.fields?.length) query.set("fields", result.fields.join(","));
    redirect(`/roof/${slug}?${query}`);
  }

  return (
    <>
      <BrandBar name={link.brandName} />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 p-4">
        <header>
          <h1 className="page-title">Get a roofing estimate</h1>
          <p className="text-sm text-muted">
            Tell us about the house. We&apos;ll call or text to set up a visit.
            {link.brandPhone && <> Or call <a className="underline" href={`tel:${link.brandPhone}`}>{formatPhone(link.brandPhone)}</a>.</>}
          </p>
        </header>

        {typeof error === "string" && ERRORS[error] && <Flash tone="error">{ERRORS[error]}</Flash>}

        <LeadForm action={submit} formToken={newFormToken()} bad={typeof fields === "string" ? fields.split(",") : []} />

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
      </main>
    </>
  );
}
