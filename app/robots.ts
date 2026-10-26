import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site/config";

/**
 * Crawlers get the public pages only. Staff screens and customer links are
 * also marked noindex in their own metadata; this keeps crawlers from
 * fetching them at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/office", "/driver", "/crew", "/login", "/auth", "/api", "/p/", "/f/", "/r/"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
