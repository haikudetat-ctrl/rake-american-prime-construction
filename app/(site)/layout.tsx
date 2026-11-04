import type { Metadata } from "next";
import { Bebas_Neue, Cormorant_Garamond } from "next/font/google";
import { siteOrigin } from "@/lib/site/config";
import s from "./site.module.css";

const display = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas", display: "swap" });
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: "400", variable: "--font-serif", display: "swap" });

/**
 * The public website. The root layout keeps everything else (office, driver,
 * proposals) out of search results; these pages opt back in one by one.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
};

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <div className={`${display.variable} ${serif.variable} ${s.site}`}>{children}</div>;
}
