import type { Metadata } from "next";
import { Sora } from "next/font/google";
import { siteOrigin } from "@/lib/site/config";
import s from "./site.module.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });

/**
 * The public website. The root layout keeps everything else (office, driver,
 * proposals) out of search results; these pages opt back in one by one.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
};

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <div className={`${sora.variable} ${s.site}`}>{children}</div>;
}
