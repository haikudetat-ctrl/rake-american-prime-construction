import { afterEach, describe, expect, it, vi } from "vitest";
import { brandRedirect, brandRewrites, canonicalUrl, siteForHost, siteOrigin, sitemapPages } from "@/lib/site/config";

afterEach(() => vi.unstubAllEnvs());

function env(values: Record<string, string>) {
  for (const key of ["APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "DROPWISE_SITE_URL", "ROOFING_SITE_URL"]) {
    vi.stubEnv(key, values[key] ?? "");
  }
}

describe("public site URLs", () => {
  it("uses APP_URL as the main origin, without a trailing path", () => {
    env({ APP_URL: "https://americanprime.example/" });
    expect(siteOrigin()).toBe("https://americanprime.example");
    expect(canonicalUrl("company")).toBe("https://americanprime.example/");
    expect(canonicalUrl("dumpster")).toBe("https://americanprime.example/dumpsters");
    expect(canonicalUrl("contractors")).toBe("https://americanprime.example/roofing/contractors");
  });

  it("falls back to the Vercel production host", () => {
    env({ VERCEL_PROJECT_PRODUCTION_URL: "rake-american-prime-construction.vercel.app" });
    expect(siteOrigin()).toBe("https://rake-american-prime-construction.vercel.app");
  });

  it("points a brand's canonical URLs at its own domain once it has one", () => {
    env({ APP_URL: "https://americanprime.example", DROPWISE_SITE_URL: "dropwise.example", ROOFING_SITE_URL: "https://aproof.example" });
    expect(canonicalUrl("dumpster")).toBe("https://dropwise.example/");
    expect(canonicalUrl("roofing")).toBe("https://aproof.example/");
    expect(canonicalUrl("contractors")).toBe("https://aproof.example/contractors");
    expect(canonicalUrl("company")).toBe("https://americanprime.example/");
  });
});

describe("brand domain rewrites", () => {
  it("does nothing until a brand domain is set", () => {
    env({ APP_URL: "https://americanprime.example" });
    expect(brandRewrites().size).toBe(0);
  });

  it("serves the brand page at the root of its domain and leaves other paths alone", () => {
    env({ DROPWISE_SITE_URL: "https://dropwise.example", ROOFING_SITE_URL: "https://aproof.example" });
    const rewrites = brandRewrites();
    expect(rewrites.get("dropwise.example")).toEqual({ "/": "/dumpsters" });
    expect(rewrites.get("aproof.example")).toEqual({ "/": "/roofing", "/contractors": "/roofing/contractors" });
    expect(rewrites.get("dropwise.example")?.["/request/dumpster"]).toBeUndefined();
  });

  it("ignores a value that is not a URL", () => {
    env({ DROPWISE_SITE_URL: "not a url" });
    expect(brandRewrites().size).toBe(0);
  });
});

const PROD = {
  APP_URL: "https://www.americanprime.example",
  DROPWISE_SITE_URL: "https://dropwise.example",
  ROOFING_SITE_URL: "https://aproof.example",
};

describe("one robots.txt and sitemap per domain", () => {
  it("knows which site a host is, and treats anything else as hidden", () => {
    env(PROD);
    expect(siteForHost("www.americanprime.example")).toBe("company");
    expect(siteForHost("APROOF.example")).toBe("roofing");
    expect(siteForHost("dropwise.example")).toBe("dumpster");
    expect(siteForHost("rake-american-prime-construction.vercel.app")).toBe("other");
    expect(siteForHost("localhost:3000")).toBe("other");
  });

  it("never treats the Vercel fallback origin as the main site", () => {
    env({ VERCEL_PROJECT_PRODUCTION_URL: "rake-american-prime-construction.vercel.app" });
    expect(siteForHost("rake-american-prime-construction.vercel.app")).toBe("other");
  });

  it("lists each page in its own domain's sitemap only", () => {
    env(PROD);
    expect(sitemapPages("company").map((p) => p.url)).toEqual(["https://www.americanprime.example/"]);
    expect(sitemapPages("roofing").map((p) => p.url)).toEqual(["https://aproof.example/", "https://aproof.example/contractors"]);
    expect(sitemapPages("dumpster").map((p) => p.url)).toEqual(["https://dropwise.example/"]);
    expect(sitemapPages("other")).toEqual([]);
  });

  it("lists every page on the main site until brands have domains", () => {
    env({ APP_URL: "https://www.americanprime.example" });
    expect(sitemapPages("company").map((p) => p.url)).toEqual([
      "https://www.americanprime.example/",
      "https://www.americanprime.example/roofing",
      "https://www.americanprime.example/roofing/contractors",
      "https://www.americanprime.example/dumpsters",
    ]);
  });
});

describe("brand pages redirect to their own domain", () => {
  it("sends brand paths on other hosts to the brand domain", () => {
    env(PROD);
    expect(brandRedirect("www.americanprime.example", "/dumpsters")).toBe("https://dropwise.example/");
    expect(brandRedirect("dropwise.example", "/roofing")).toBe("https://aproof.example/");
    expect(brandRedirect("dropwise.example", "/roofing/contractors")).toBe("https://aproof.example/contractors");
  });

  it("collapses the long path on the brand's own domain to its root", () => {
    env(PROD);
    expect(brandRedirect("aproof.example", "/roofing")).toBe("https://aproof.example/");
    expect(brandRedirect("aproof.example", "/roofing/contractors")).toBe("https://aproof.example/contractors");
    expect(brandRedirect("dropwise.example", "/dumpsters")).toBe("https://dropwise.example/");
  });

  it("leaves the root, request links and legal pages alone", () => {
    env(PROD);
    for (const path of ["/", "/contractors", "/request/dumpster", "/roof/roof", "/privacy", "/terms", "/login"]) {
      expect(brandRedirect("aproof.example", path)).toBeNull();
      expect(brandRedirect("www.americanprime.example", path)).toBeNull();
    }
  });

  it("does nothing until a brand has a domain", () => {
    env({ APP_URL: "https://www.americanprime.example" });
    expect(brandRedirect("www.americanprime.example", "/dumpsters")).toBeNull();
    expect(brandRedirect("www.americanprime.example", "/roofing")).toBeNull();
  });
});
