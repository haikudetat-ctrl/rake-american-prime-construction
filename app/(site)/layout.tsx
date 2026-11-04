import type { Metadata } from "next";
import { publicDisplay, publicSerif } from "@/app/_components/public-fonts";
import { siteOrigin } from "@/lib/site/config";
import s from "./site.module.css";

/**
 * The public website. The root layout keeps everything else (office, driver,
 * proposals) out of search results; these pages opt back in one by one.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
};

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <div className={`${publicDisplay.variable} ${publicSerif.variable} ${s.site}`}>{children}</div>;
}
