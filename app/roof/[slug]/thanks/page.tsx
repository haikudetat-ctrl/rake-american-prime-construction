import { notFound } from "next/navigation";
import { loadRequestLink } from "@/lib/intake/submit";
import { IntakeSuccess } from "@/app/_components/intake-shell";

export default async function RoofThanksPage({ params }: PageProps<"/roof/[slug]/thanks">) {
  const { slug } = await params;
  const link = await loadRequestLink(slug, "roofing");
  if (!link) notFound();
  return <IntakeSuccess kind="roofing" phone={link.brandPhone} />;
}
