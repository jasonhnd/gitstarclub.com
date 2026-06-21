import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "./_explore/RegisterSW";
import { Footer } from "./_explore/Footer";
import { getMeta } from "@/lib/data";
import { I18nProvider } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";

const plusJakarta = Plus_Jakarta_Sans({ variable: "--font-plus-jakarta", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description =
  "A browsable pulse and chronicle of open source. See what is rising this week, this month, this year, and across GitHub star history.";

// metadataBase from env; indexing OFF until launch (private preview — SEO §11). Flip SITE_INDEXABLE=1 at launch.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const indexable = process.env.SITE_INDEXABLE === "1";

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
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#121316" },
  ],
};

// Language is an in-page preference stored in a first-party cookie; URLs stay canonical.
// The server renders the default locale (English) so pages stay static/ISR; the client
// I18nProvider reads the cookie after hydration and swaps the chrome strings. The data
// (`seam_date`) is locale-independent.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const meta = await getMeta();
  return (
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning className={`${plusJakarta.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-svh flex-col">
        <I18nProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <div className="contents">
            {children}
            <Footer asOf={meta?.seam_date} />
          </div>
        </I18nProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
