import { PATHS } from "@/lib/site/config";

/** Header links for the Authority Roofing pages. */
export function roofingNav(current?: "contractors") {
  return [
    { href: `${PATHS.roofing}#services`, label: "Services" },
    { href: `${PATHS.roofing}#how`, label: "How it works" },
    { href: `${PATHS.roofing}#warranty`, label: "Warranty" },
    { href: PATHS.contractors, label: "For contractors", current: current === "contractors" },
  ];
}
