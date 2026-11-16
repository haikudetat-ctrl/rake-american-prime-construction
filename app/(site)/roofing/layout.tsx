import localFont from "next/font/local";
import s from "../site.module.css";

/**
 * Authority Roofing sets its secondary headlines (the hero intro and the light
 * lines under section titles) in Roboto instead of the site-wide serif. Scoped
 * to /roofing and /roofing/contractors; the hub and DropWise keep the serif.
 * Self-hosted like Inter (app/fonts), so builds never depend on Google Fonts.
 */
const roboto = localFont({
  src: "../../fonts/roboto-latin-wght.woff2",
  variable: "--font-roboto",
  weight: "100 900",
  display: "swap",
});

export default function RoofingLayout({ children }: LayoutProps<"/roofing">) {
  return <div className={`${roboto.variable} ${s.roofing}`}>{children}</div>;
}
