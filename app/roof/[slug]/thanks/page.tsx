import { notFound } from "next/navigation";
import { loadRequestLink } from "@/lib/intake/submit";
import { formatPhone } from "@/lib/phone";

export default async function RoofThanksPage({ params }: PageProps<"/roof/[slug]/thanks">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug, "roofing");
  if (!link) notFound();
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-3 p-4">
      <p className="text-sm text-muted">{link.brandName}</p>
      <h1 className="text-2xl font-semibold">Thanks — we got it.</h1>
      <p>We&apos;ll reach out shortly to set up a time to look at the roof.</p>
      {link.brandPhone && (
        <p>
          In a hurry? Call or text{" "}
          <a className="underline" href={`tel:${link.brandPhone}`}>{formatPhone(link.brandPhone)}</a>.
        </p>
      )}
    </main>
  );
}
