import { addGalleryPhoto, removeGalleryPhoto } from "@/app/office/actions";
import { adminClient } from "@/lib/supabase/admin";

/** Owner-only. Past-job photos shown on the public roofing estimate page. */
export function GalleryCard({ photos }: { photos: { id: string; path: string; caption: string | null }[] | null }) {
  const storage = adminClient().storage.from("gallery");
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Roofing page photos</h2>
      <p className="text-sm text-muted">Past jobs shown under the form on the roofing estimate link.</p>
      {(photos ?? []).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos!.map((p) => (
            <figure key={p.id} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs */}
              <img src={storage.getPublicUrl(p.path).data.publicUrl} alt={p.caption ?? "Past job"}
                className="aspect-[4/3] w-full rounded-md object-cover" />
              <figcaption className="flex items-start justify-between gap-2 text-xs">
                <span className="text-muted">{p.caption}</span>
                <form action={removeGalleryPhoto}>
                  <input type="hidden" name="photoId" value={p.id} />
                  <button className="text-danger underline">Remove</button>
                </form>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <form action={addGalleryPhoto} className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <label className="label"><span>Photo (JPEG, PNG or WebP, under 4 MB)</span>
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="input" />
        </label>
        <label className="label"><span>Caption (optional)</span>
          <input name="caption" className="input" placeholder="GAF Timberline HDZ, Ventnor" />
        </label>
        <button className="btn sm:justify-self-start">Add photo</button>
      </form>
    </section>
  );
}
