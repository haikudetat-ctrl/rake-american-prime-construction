import { afterEach, describe, expect, it, vi } from "vitest";
import { brandRewrites, canonicalUrl, siteOrigin } from "@/lib/site/config";

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
