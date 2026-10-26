import "server-only";
import { unstable_cache } from "next/cache";
import { adminClient } from "@/lib/supabase/admin";

/**
 * The few things on the public pages that the office edits in Rake: the
 * brands' phone and email (Settings), the roofing systems on offer (the
 * active catalog) and the past-job photos (Settings → roofing page photos).
 *
 * Read once and cached, so the pages stay static. Saving any of these in
 * Settings revalidates SITE_CONTENT_TAG; otherwise the cache refreshes hourly.
 * Without database credentials (a local build, a preview without secrets)
 * the pages render with these sections left out instead of failing.
 */
export const SITE_CONTENT_TAG = "site-content";

export type BrandContact = { phone: string | null; email: string | null };
export type RoofSystem = { tier: "good" | "better" | "best"; name: string };
export type GalleryPhoto = { url: string; caption: string | null };

export type SiteContent = {
  contacts: { roofing: BrandContact; dumpster: BrandContact };
  systems: RoofSystem[];
  /** Names of the optional extras on a proposal (gutters, flashing...). */
  addons: string[];
  gallery: GalleryPhoto[];
};

const NO_CONTACT: BrandContact = { phone: null, email: null };
const EMPTY: SiteContent = {
  contacts: { roofing: NO_CONTACT, dumpster: NO_CONTACT },
  systems: [],
  addons: [],
  gallery: [],
};
const TIER_ORDER = { good: 0, better: 1, best: 2 } as const;
const COMPANY_SLUG = "american-prime";

async function load(): Promise<SiteContent> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return EMPTY;
  try {
    const db = adminClient();
    const { data: company } = await db.from("companies").select("id").eq("slug", COMPANY_SLUG).maybeSingle();
    if (!company) return EMPTY;

    const [brands, catalog, photos] = await Promise.all([
      db.from("brands").select("id, kind, phone, email").eq("company_id", company.id),
      db.from("catalog_versions").select("data").eq("company_id", company.id).eq("is_active", true).maybeSingle(),
      db.from("gallery_photos").select("path, caption, brand_id").eq("company_id", company.id)
        .order("sort").order("created_at").limit(12),
    ]);

    const contacts = { roofing: NO_CONTACT, dumpster: NO_CONTACT };
    let roofingBrandId: string | null = null;
    for (const b of brands.data ?? []) {
      const kind = b.kind as "roofing" | "dumpster";
      contacts[kind] = { phone: b.phone ?? null, email: b.email ?? null };
      if (kind === "roofing") roofingBrandId = b.id;
    }

    type Item = { tier?: string; name?: string; active?: boolean };
    const data = (catalog.data?.data ?? null) as { systems?: Item[]; addons?: Item[] } | null;
    const rawSystems = data?.systems ?? [];
    const systems = rawSystems
      .filter((s): s is RoofSystem & { active?: boolean } =>
        s.active !== false && typeof s.name === "string" && s.name.length > 0 && !!s.tier && s.tier in TIER_ORDER)
      .map((s) => ({ tier: s.tier, name: s.name }))
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

    const addons = (data?.addons ?? [])
      .filter((a) => a.active !== false && typeof a.name === "string" && a.name.length > 0)
      .map((a) => a.name as string);

    const gallery = (photos.data ?? [])
      .filter((p) => p.brand_id === roofingBrandId)
      .map((p) => ({ url: db.storage.from("gallery").getPublicUrl(p.path).data.publicUrl, caption: p.caption ?? null }));

    return { contacts, systems, addons, gallery };
  } catch (error) {
    console.error("site content unavailable", error);
    return EMPTY;
  }
}

export const getSiteContent = unstable_cache(load, ["site-content-v1"], {
  tags: [SITE_CONTENT_TAG],
  revalidate: 3600,
});
