import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BrandBar } from "@/app/_components/brand";
import { RequestForm } from "@/app/request/[slug]/request-form";
import { addDays, companyToday } from "@/lib/dates";
import type { IntakeFailure } from "@/lib/intake/messages";
import { loadRequestLink, newFormToken, submitRentalRequest } from "@/lib/intake/submit";

export const metadata: Metadata = { title: "Request a dumpster" };

export default async function RequestPage({ params }: PageProps<"/request/[slug]">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug);
  if (!link) notFound();

  const today = companyToday();

  // Returns what was wrong instead of redirecting, so the form keeps what was typed.
  async function submit(formData: FormData): Promise<IntakeFailure | undefined> {
    "use server";
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
    const result = await submitRentalRequest(slug, formData, ip);
    if (result.ok) redirect(`/request/${slug}/thanks`);
    if (result.error === "unknown_link") notFound();
    return { error: result.error, fields: result.fields };
  }

  return (
    <>
      <BrandBar name={link.brandName} />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 p-4">
        <header>
          <h1 className="page-title">Request a dumpster</h1>
          <p className="text-sm text-muted">
            Tell us where and when. We&apos;ll confirm by text before we drop it off.
          </p>
        </header>

        <RequestForm action={submit} formToken={newFormToken()} today={today} tomorrow={addDays(today, 1)} />
      </main>
    </>
  );
}
