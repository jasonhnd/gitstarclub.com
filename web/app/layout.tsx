import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "./_explore/RegisterSW";

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

// Runs before paint: explicit override wins, else follow system. Prevents a theme flash.
const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"#121316":"#fbfbfd");}}catch(e){}})();`;

// Document default is en; the [lang] layout scopes per-locale lang on its subtree (lang attribute
// is valid on any element). hreflang in each page's metadata carries the search-engine signal.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plusJakarta.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="flex min-h-svh flex-col">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
