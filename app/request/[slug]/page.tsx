import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { IntakeShell } from "@/app/_components/intake-shell";
import { DUMPSTER_SIZES } from "@/lib/intake/sizes";
import { RequestForm } from "@/app/request/[slug]/request-form";
import { addDays, companyToday } from "@/lib/dates";
import type { IntakeFailure } from "@/lib/intake/messages";
import { loadRequestLink, newFormToken, submitRentalRequest } from "@/lib/intake/submit";

export const metadata: Metadata = { title: "Request a dumpster" };

export default async function RequestPage({ params, searchParams }: PageProps<"/request/[slug]">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug);
  if (!link) notFound();

  const today = companyToday();
  const sizeParam = (await searchParams).size;
  const defaultSize = typeof sizeParam === "string" ? DUMPSTER_SIZES.find(size => String(size) === sizeParam) : undefined;

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
    <IntakeShell kind="dumpster" title="A little room for your next project." intro="Tell us where and when. We’ll help with the size and confirm your rental details." phone={link.brandPhone}>
      <RequestForm action={submit} formToken={newFormToken()} today={today} tomorrow={addDays(today, 1)} defaultSize={defaultSize} />
    </IntakeShell>
  );
}
