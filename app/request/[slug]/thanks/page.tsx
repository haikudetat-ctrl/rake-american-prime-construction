import { notFound } from "next/navigation";
import { loadRequestLink } from "@/lib/intake/submit";
import { formatPhone } from "@/lib/phone";

export default async function ThanksPage({ params }: PageProps<"/request/[slug]/thanks">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug);
  if (!link) notFound();
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 p-4">
      <p className="text-sm text-muted">{link.brandName}</p>
      <h1 className="text-2xl font-semibold">Got it — thanks.</h1>
      <p>We&apos;ll text you to confirm the drop-off date.</p>
      {link.brandPhone && (
        <p>
          Need to change something? Call or text{" "}
          <a className="underline" href={`tel:${link.brandPhone}`}>{formatPhone(link.brandPhone)}</a>.
        </p>
      )}
    </main>
  );
}
