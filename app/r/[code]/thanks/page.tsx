import { notFound } from "next/navigation";
import { loadReferrer } from "@/lib/leads/submit";
import { IntakeSuccess } from "@/app/_components/intake-shell";

export default async function ReferralThanksPage({ params }: PageProps<"/r/[code]/thanks">) {
  const { code } = await params;
  const referrer = await loadReferrer(code);
  if (!referrer) notFound();
  return <IntakeSuccess kind="roofing" referral={referrer.firstName} />;
}
