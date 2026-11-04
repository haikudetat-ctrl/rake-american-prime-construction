import { notFound } from "next/navigation";
import { loadRequestLink } from "@/lib/intake/submit";
import { IntakeSuccess } from "@/app/_components/intake-shell";

export default async function ThanksPage({ params }: PageProps<"/request/[slug]/thanks">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug);
  if (!link) notFound();
  return <IntakeSuccess kind="dumpster" phone={link.brandPhone} />;
}
