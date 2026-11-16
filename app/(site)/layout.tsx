import type { Metadata } from "next";
import localFont from "next/font/local";
import { Bebas_Neue } from "next/font/google";
import { siteOrigin } from "@/lib/site/config";
import s from "./site.module.css";

const display = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas", display: "swap" });
/** The conversational lines (hero intros, the light lines under headings) on every brand. Self-hosted like Inter. */
const talk = localFont({ src: "../fonts/roboto-latin-wght.woff2", variable: "--font-roboto", weight: "100 900", display: "swap" });

/**
 * The public website. The root layout keeps everything else (office, driver,
 * proposals) out of search results; these pages opt back in one by one.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
};

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <div className={`${display.variable} ${talk.variable} ${s.site}`}>{children}</div>;
}
