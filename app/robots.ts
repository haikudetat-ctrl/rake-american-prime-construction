import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { originForSite, siteForHost } from "@/lib/site/config";

/** Staff screens, sign-in, the API and tokenized customer links (proposals, forms, referrals). */
const PRIVATE_PATHS = ["/office", "/driver", "/crew", "/login", "/auth", "/api", "/p/", "/f/", "/r/"];

/**
 * One robots.txt per domain. Each production domain points crawlers at its
 * own sitemap; any other host (the vercel.app address, previews) also sends
 * X-Robots-Tag: noindex from the proxy, so it lists no sitemap here.
 *
 * Staff screens and customer links are also marked noindex in their own
 * metadata; this keeps crawlers from fetching them at all.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  const site = siteForHost(host);
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    ...(site === "other" ? {} : { sitemap: `${originForSite(site)}/sitemap.xml` }),
  };
}
