import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteAnalytics } from "@/app/_components/site-analytics";
import "./globals.css";

// Self-hosted (Inter 4 variable, Latin subset, OFL: app/fonts/OFL.txt) so the build never
// waits on a Google Fonts download, which has failed previews on this account before.
const inter = localFont({
  src: "./fonts/inter-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "American Prime",
  description: "Dumpster operations for American Prime Construction",
  // Operational tool holding customer data. Public pages opt back in.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#182623",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
