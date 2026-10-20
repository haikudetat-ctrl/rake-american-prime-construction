import { notFound } from "next/navigation";
import { loadReferrer } from "@/lib/leads/submit";
import { BrandBar } from "@/app/_components/brand";

export default async function ReferralThanksPage({ params }: PageProps<"/r/[code]/thanks">) {
  const { code } = await params;
  const referrer = await loadReferrer(code);
  if (!referrer) notFound();
  return (
    <>
      <BrandBar />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-3 p-4">
        <h1 className="page-title">Thanks — we got it.</h1>
        <p>We&apos;ll reach out shortly to set up a time to look at your roof. Say thanks to {referrer.firstName} for us!</p>
      </main>
    </>
  );
}
