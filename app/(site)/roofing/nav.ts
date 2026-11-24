import { canonicalUrl } from "@/lib/site/config";

/** Header links for the Authority Roofing pages. */
export function roofingNav(current?: "contractors") {
  return [
    { href: `${canonicalUrl("roofing")}#services`, label: "Services" },
    { href: `${canonicalUrl("roofing")}#how`, label: "How it works" },
    { href: `${canonicalUrl("roofing")}#warranty`, label: "Warranty" },
    { href: canonicalUrl("contractors"), label: "For contractors", current: current === "contractors" },
  ];
}
