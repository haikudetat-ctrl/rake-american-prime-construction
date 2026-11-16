import { Cormorant_Garamond } from "next/font/google";
import s from "../site.module.css";

/**
 * Authority Roofing: buttons and accents in the logo's orange (.roofing). Cormorant is only for
 * the signature on the sample proposal, so it loads here rather than on every page.
 */
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: "400", variable: "--font-serif", display: "swap" });

export default function RoofingLayout({ children }: LayoutProps<"/roofing">) {
  return <div className={`${serif.variable} ${s.roofing}`}>{children}</div>;
}
