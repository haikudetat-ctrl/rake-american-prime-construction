/**
 * The public website: one parent company and two customer-facing brands.
 *
 *   /                      American Prime Construction (the parent, a directory of the two)
 *   /roofing               Authority Roofing (homeowners)
 *   /roofing/contractors   Authority Roofing (roofing crews for contractors)
 *   /dumpsters             DropWise Dumpsters
 *
 * Every call to action goes to an existing Rake request link, so a website
 * lead lands in Roofing Leads or Dumpster Requests with nothing in between.
 *
 * Facts on these pages come from the business itself (proposal settings,
 * catalog, request links). Anything not yet confirmed by the owner is left
 * off rather than guessed; see docs/website.md for the open items.
 */

export type SiteBrand = "company" | "roofing" | "dumpster";

export const COMPANY_NAME = "American Prime Construction";
export const ROOFING_NAME = "Authority Roofing";
export const DROPWISE_NAME = "DropWise Dumpsters";

/** NJ Home Improvement Contractor registration, printed on every proposal. */
export const HIC_NUMBER = "13VH13312300";
export const WORKMANSHIP_WARRANTY_YEARS = 10;

/** The only service area the business has confirmed publicly so far. */
export const SERVICE_AREA = "the Atlantic City area";

/** Public request links (rows in public.request_links). */
export const REQUEST_HREF = {
  roofing: "/roof/roof",
  dumpster: "/request/dumpster",
} as const;

export const PATHS = {
  company: "/",
  roofing: "/roofing",
  contractors: "/roofing/contractors",
  dumpster: "/dumpsters",
} as const;

function clean(url: string | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Origin of the main site. APP_URL is the same address texts and proposals use. */
export function siteOrigin(): string {
  return (
    clean(process.env.APP_URL) ??
    clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    "http://localhost:3000"
  );
}

/**
 * A brand can move to its own domain later (DROPWISE_SITE_URL, ROOFING_SITE_URL).
 * The proxy then serves that brand's page at the domain root, and canonical
 * URLs point there. Until then everything lives under the main site.
 */
export function brandOrigin(brand: "roofing" | "dumpster"): string | null {
  return clean(brand === "dumpster" ? process.env.DROPWISE_SITE_URL : process.env.ROOFING_SITE_URL);
}

/** Absolute canonical URL for a public page. */
export function canonicalUrl(page: keyof typeof PATHS): string {
  if (page === "dumpster") {
    const own = brandOrigin("dumpster");
    if (own) return `${own}/`;
  }
  if (page === "roofing" || page === "contractors") {
    const own = brandOrigin("roofing");
    if (own) return page === "roofing" ? `${own}/` : `${own}/contractors`;
  }
  return `${siteOrigin()}${PATHS[page] === "/" ? "/" : PATHS[page]}`;
}

/**
 * Path rewrites for a brand's own domain, keyed by host. Read by the proxy;
 * empty unless a brand domain is configured. Paths not listed (request
 * links, proposals, sign-in) work the same on every host.
 */
export function brandRewrites(): Map<string, Record<string, string>> {
  const hosts = new Map<string, Record<string, string>>();
  const dropwise = brandOrigin("dumpster");
  if (dropwise) hosts.set(new URL(dropwise).host, { "/": PATHS.dumpster });
  const roofing = brandOrigin("roofing");
  if (roofing) hosts.set(new URL(roofing).host, { "/": PATHS.roofing, "/contractors": PATHS.contractors });
  return hosts;
}

/** Which public site a request host belongs to. "other" is any host that is not a production domain (vercel.app, previews, localhost). */
export type SiteHost = "company" | "roofing" | "dumpster" | "other";

function hostOf(origin: string | null): string | null {
  return origin ? new URL(origin).host : null;
}

export function siteForHost(host: string): SiteHost {
  const h = host.toLowerCase();
  if (h === hostOf(brandOrigin("roofing"))) return "roofing";
  if (h === hostOf(brandOrigin("dumpster"))) return "dumpster";
  // Only a real domain counts as the main site. Falling back to the Vercel
  // host or localhost would make those indexable.
  if (h === hostOf(clean(process.env.APP_URL))) return "company";
  return "other";
}

/** Origin for a host's own robots.txt and sitemap. */
export function originForSite(site: Exclude<SiteHost, "other">): string {
  if (site === "company") return siteOrigin();
  return brandOrigin(site) ?? siteOrigin();
}

/**
 * Indexable pages a host's sitemap lists. Each URL is its canonical, so a
 * page appears in exactly one domain's sitemap. The legal pages are
 * reachable on every domain but stay out of search (noindex), so they are
 * not listed.
 */
export function sitemapPages(site: SiteHost): { url: string; priority: number }[] {
  if (site === "other") return [];
  const origin = originForSite(site);
  const all: { page: keyof typeof PATHS; priority: number }[] = [
    { page: "company", priority: 1 },
    { page: "roofing", priority: 0.9 },
    { page: "contractors", priority: 0.6 },
    { page: "dumpster", priority: 0.9 },
  ];
  return all
    .map(({ page, priority }) => ({ url: canonicalUrl(page), priority }))
    .filter(({ url }) => url === `${origin}/` || url.startsWith(`${origin}/`));
}

export const LEGAL_PATHS = { privacy: "/privacy", terms: "/terms" } as const;

/**
 * A brand page requested on a host that is not its canonical home gets a
 * permanent redirect there (apconstructionnj.com/dumpsters, or /roofing on
 * the roofing domain itself). Only once a brand domain is set; until then
 * the paths are the brand's home. Returns null to serve the request.
 */
export function brandRedirect(host: string, pathname: string): string | null {
  const brandPaths: [string, keyof typeof PATHS][] = [
    [PATHS.dumpster, "dumpster"],
    [PATHS.contractors, "contractors"],
    [PATHS.roofing, "roofing"],
  ];
  const match = brandPaths.find(([path]) => pathname === path);
  if (!match) return null;
  const page = match[1];
  const brand = page === "dumpster" ? "dumpster" : "roofing";
  if (!brandOrigin(brand)) return null;
  const target = canonicalUrl(page);
  const here = `https://${host.toLowerCase()}${pathname}`;
  return target === here ? null : target;
}
