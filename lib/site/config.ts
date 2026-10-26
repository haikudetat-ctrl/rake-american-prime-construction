/**
 * The public website: one parent company and two customer-facing brands.
 *
 *   /                      American Prime Construction (the parent, a directory of the two)
 *   /roofing               AP Roofing & Gutters (homeowners)
 *   /roofing/contractors   AP Roofing & Gutters (roofing crews for contractors)
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
export const ROOFING_NAME = "AP Roofing & Gutters";
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
