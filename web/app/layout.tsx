import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "./_explore/RegisterSW";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A browsable chronicle of open source. Look back, month by month and year by year, at which GitHub projects were rising.";

// metadataBase from env (SEO §2); falls back to the eventual production domain.
// Indexing stays OFF until launch — the web app runs as a private preview while the
// teaser owns the production domain (SEO §11 / OPS deploy topology). Flip SITE_INDEXABLE=1 at launch.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const indexable = process.env.SITE_INDEXABLE === "1";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: "%s · gitstarclub",
    default: "gitstarclub — A Chronicle of Open Source",
  },
  description,
  robots: { index: indexable, follow: indexable },
  openGraph: {
    type: "website",
    siteName: "gitstarclub",
    title: "gitstarclub — A Chronicle of Open Source",
    description,
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "gitstarclub — A Chronicle of Open Source",
    description,
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "gitstarclub",
    statusBarStyle: "default",
  },
  other: {
    // legacy iOS standalone flag (modern iOS uses manifest display:standalone)
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#121316" },
  ],
};

// Runs before paint: explicit override wins, else follow system. Prevents
// a flash of the wrong theme on load.
const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"#121316":"#fbfbfd");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${geistMono.variable}`}
    >
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
