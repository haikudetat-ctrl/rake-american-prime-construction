import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { siteForHost, sitemapPages } from "@/lib/site/config";

/**
 * Each domain lists only the pages whose canonical URL is on that domain:
 * the parent site lists its homepage, authorityroofingnj.com its two
 * roofing pages, dropwisedumpsters.com its dumpster page. Until a brand has
 * its own domain, its pages are listed by the main site.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return sitemapPages(siteForHost(host)).map((page) => ({ ...page, changeFrequency: "monthly" }));
}
