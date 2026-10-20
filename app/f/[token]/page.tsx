import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { adminClient } from "@/lib/supabase/admin";
import { BrandBar } from "@/app/_components/brand";

export const metadata: Metadata = { title: "How did we do?", robots: { index: false, follow: false } };

const ANSWERS = [
  { value: "great", label: "Great", emoji: "😀" },
  { value: "okay", label: "Okay", emoji: "😐" },
  { value: "poor", label: "Not good", emoji: "🙁" },
] as const;

/** "How did we do?" A great answer gets the Google review link; anything else goes to the owner first. */
export default async function FeedbackPage({ params, searchParams }: PageProps<"/f/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = adminClient();
  const { data: care } = await db.from("aftercare").select("customer_name, rating, referral_code, company_id").eq("token", token).maybeSingle();
  if (!care) notFound();
  const [{ data: brand }, { data: settings }] = await Promise.all([
    db.from("brands").select("display_name, phone").eq("company_id", care.company_id).eq("kind", "roofing").maybeSingle(),
    db.from("review_settings").select("google_review_url").eq("company_id", care.company_id).maybeSingle(),
  ]);
  const brandName = brand?.display_name ?? "American Prime Construction";
  const first = care.customer_name.split(/\s+/)[0];

  async function answer(form: FormData) {
    "use server";
    const rating = String(form.get("rating") ?? "");
    await adminClient().rpc("submit_feedback", { p_token: token, p_rating: rating, p_comment: String(form.get("comment") ?? "") });
    redirect(`/f/${token}?thanks=1`);
  }

  return (
    <>
      <BrandBar name={brandName} />
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 p-4">
        {!care.rating ? (
          <form action={answer} className="card space-y-4">
            <h1 className="page-title">How did we do, {first}?</h1>
            <div className="grid grid-cols-3 gap-2">
              {ANSWERS.map((a) => (
                <label key={a.value} className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-border p-3 has-[:checked]:border-accent">
                  <input type="radio" name="rating" value={a.value} required className="sr-only" />
                  <span className="text-3xl" aria-hidden="true">{a.emoji}</span>
                  <span className="text-sm">{a.label}</span>
                </label>
              ))}
            </div>
            <label className="label">
              <span>Anything you want us to know? (optional)</span>
              <textarea name="comment" rows={3} maxLength={1000} className="input" />
            </label>
            <button className="btn w-full py-3">Send</button>
          </form>
        ) : care.rating === "great" ? (
          <section className="card space-y-4">
            <h1 className="page-title">Thank you, {first}!</h1>
            {settings?.google_review_url && (
              <>
                <p>Would you share that in a Google review? It takes a minute and helps neighbors find a roofer they can trust.</p>
                <a className="btn w-full py-3" href={`/f/${token}/review`}>Leave a Google review</a>
              </>
            )}
            <div className="border-t border-border pt-4">
              <p className="font-medium">Know someone who needs a roof?</p>
              <p className="text-sm text-muted">Send them your link. We&apos;ll thank you when their roof is done.</p>
              <p className="mt-2 break-all rounded-md bg-background p-2 text-sm">{process.env.APP_URL ?? ""}/r/{care.referral_code}</p>
            </div>
          </section>
        ) : (
          <section className="card space-y-2">
            <h1 className="page-title">Thank you for telling us.</h1>
            <p>{query.thanks ? "We'll call you to make it right." : "We've got your answer and we'll be in touch."}
              {brand?.phone && <> You can also reach us at <a className="underline" href={`tel:${brand.phone}`}>{brand.phone}</a>.</>}</p>
          </section>
        )}
      </main>
    </>
  );
}
