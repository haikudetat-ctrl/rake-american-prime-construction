import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LeadForm } from "@/app/roof/[slug]/lead-form";
import type { IntakeFailure } from "@/lib/intake/messages";
import { newFormToken } from "@/lib/intake/submit";
import { loadGallery, loadReferrer, submitReferralLead } from "@/lib/leads/submit";
import { adminClient } from "@/lib/supabase/admin";
import { BrandBar } from "@/app/_components/brand";

export const metadata: Metadata = { title: "Roofing estimate", robots: { index: false, follow: false } };

/** A past customer's referral link: the friend asks for an estimate, and the referral is remembered. */
export default async function ReferralPage({ params }: PageProps<"/r/[code]">) {
  const { code } = await params;
  const referrer = await loadReferrer(code);
  if (!referrer) notFound();
  const { data: brand } = await adminClient().from("brands").select("display_name").eq("id", referrer.brandId ?? "").maybeSingle();
  const gallery = referrer.brandId ? await loadGallery(referrer.brandId) : [];

  async function submit(formData: FormData): Promise<IntakeFailure | undefined> {
    "use server";
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
    const result = await submitReferralLead(code, formData, ip);
    if (result.ok) redirect(`/r/${code}/thanks`);
    if (result.error === "unknown_link") notFound();
    return { error: result.error, fields: result.fields };
  }

  return (
    <>
      <BrandBar name={brand?.display_name ?? "American Prime Construction"} />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 p-4">
        <header>
          <h1 className="page-title">{referrer.firstName} sent you our way</h1>
          <p className="text-sm text-muted">Tell us about your house and we&apos;ll call or text to set up a free estimate.</p>
        </header>
        <LeadForm action={submit} formToken={newFormToken()} />
        {gallery.length > 0 && (
          <section className="grid grid-cols-2 gap-2">
            {gallery.slice(0, 4).map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs
              <img key={photo.url} src={photo.url} alt={photo.caption ?? "A roof we finished"} loading="lazy" className="aspect-[4/3] w-full rounded-md object-cover" />
            ))}
          </section>
        )}
      </main>
    </>
  );
}
