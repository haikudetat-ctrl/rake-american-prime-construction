import type { MetadataRoute } from "next";
import { brandOrigin, canonicalUrl } from "@/lib/site/config";

/**
 * The four public pages. A brand on its own domain is listed by that
 * domain's own sitemap once it is verified in Search Console, so it drops
 * out of this one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { url: string; priority: number }[] = [{ url: canonicalUrl("company"), priority: 1 }];
  if (!brandOrigin("roofing")) {
    pages.push({ url: canonicalUrl("roofing"), priority: 0.9 }, { url: canonicalUrl("contractors"), priority: 0.6 });
  }
  if (!brandOrigin("dumpster")) pages.push({ url: canonicalUrl("dumpster"), priority: 0.9 });
  return pages.map((page) => ({ ...page, changeFrequency: "monthly" }));
}
