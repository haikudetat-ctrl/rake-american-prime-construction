import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LeadForm } from "@/app/roof/[slug]/lead-form";
import type { IntakeFailure } from "@/lib/intake/messages";
import { newFormToken } from "@/lib/intake/submit";
import { loadGallery, loadReferrer, submitReferralLead } from "@/lib/leads/submit";
import { IntakeShell } from "@/app/_components/intake-shell";

export const metadata: Metadata = { title: "Roofing estimate", robots: { index: false, follow: false } };

/** A past customer's referral link: the friend asks for an estimate, and the referral is remembered. */
export default async function ReferralPage({ params }: PageProps<"/r/[code]">) {
  const { code } = await params;
  const referrer = await loadReferrer(code);
  if (!referrer) notFound();
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
    <IntakeShell kind="roofing" title={`${referrer.firstName} sent you our way.`} intro="Tell us about your home. We’ll get in touch to arrange a roofing estimate.">
        <LeadForm action={submit} formToken={newFormToken()} />
        {gallery.length > 0 && (
          <section className="grid grid-cols-2 gap-2">
            {gallery.slice(0, 4).map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs
              <img key={photo.url} src={photo.url} alt={photo.caption ?? "A roof we finished"} loading="lazy" className="aspect-[4/3] w-full rounded-md object-cover" />
            ))}
          </section>
        )}
    </IntakeShell>
  );
}
