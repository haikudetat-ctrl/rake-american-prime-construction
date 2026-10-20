import { notFound } from "next/navigation";
import { loadRequestLink } from "@/lib/intake/submit";
import { formatPhone } from "@/lib/phone";
import { BrandBar } from "@/app/_components/brand";

export default async function ThanksPage({ params }: PageProps<"/request/[slug]/thanks">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug);
  if (!link) notFound();
  return (
    <>
      <BrandBar name={link.brandName} />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-3 p-4">
        <h1 className="page-title">Got it — thanks.</h1>
        <p>We&apos;ll text you to confirm the drop-off date.</p>
        {link.brandPhone && (
          <p>
            Need to change something? Call or text{" "}
            <a className="underline" href={`tel:${link.brandPhone}`}>{formatPhone(link.brandPhone)}</a>.
          </p>
        )}
      </main>
    </>
  );
}
