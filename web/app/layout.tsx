import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { RegisterSW } from "./_explore/RegisterSW";
import { Footer } from "./_explore/Footer";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";

const plusJakarta = Plus_Jakarta_Sans({ variable: "--font-plus-jakarta", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], preload: false });

const description =
  "A browsable pulse and chronicle of open source. See what is rising this week, this month, this year, and across GitHub star history.";

// metadataBase from env; indexing OFF until launch (private preview — SEO §11). Flip SITE_INDEXABLE=1 at launch.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const indexable = process.env.SITE_INDEXABLE === "1";
const bingSiteVerification = process.env.BING_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { template: "%s · GitStarClub", default: "GitStarClub — A Chronicle of Open Source" },
  description,
  robots: { index: indexable, follow: indexable },
  openGraph: {
    type: "website",
    siteName: "GitStarClub",
    title: "GitStarClub — A Chronicle of Open Source",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "GitStarClub — A Chronicle of Open Source",
    description,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "GitStarClub", statusBarStyle: "default" },
  other: {
    "apple-mobile-web-app-capable": "yes",
    ...(bingSiteVerification ? { "msvalidate.01": bingSiteVerification } : {}),
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#121316" },
  ],
};

// Language is route-derived by localized page wrappers. The root layout remains
// default English because Next's root layout does not receive child route params.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning className={`${plusJakarta.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-svh flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="contents">
          {children}
          <Footer />
        </div>
        <RegisterSW />
        <Analytics />
      </body>
    </html>
  );
}
