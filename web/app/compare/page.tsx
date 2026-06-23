import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { pageMeta } from "@/lib/seo";
import { T } from "@/lib/i18n/client";
import { I18nProvider } from "@/lib/i18n/client-runtime";
import { CompareClient } from "./CompareClient";

// /compare — multi-repo star-history overlay (v0.2 §5).
// Fully STATIC shell: the page itself reads no searchParams server-side. All state lives in the
// URL and is read client-side by CompareClient, so the same static HTML serves every variant.
// SEO canonical always points at `/compare` (per docs/SEO.md §2.8) so crawlers de-dupe any
// `?repos=…` permutations to the indexable landing page.

export const dynamic = "force-static";
export const revalidate = false;

export function generateMetadata(): Metadata {
  return pageMeta({
    title: "Compare GitHub Star History",
    description:
      "Overlay the star-history curves of any tracked repositories (≥10k stars) on one chart — absolute or aligned from 10k.",
    path: "/compare",
    locale: "en",
  });
}

export default function ComparePage() {
  return (
    <>
      <Chrome />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs items={[{ path: "nav.home", href: "/" }, { path: "compare.title" }]} />
        <header className="mt-4 animate-rise">
          <h1 className="font-mono text-[clamp(1.4rem,4vw,2.2rem)] font-semibold text-on-surface">
            <T path="compare.title" />
          </h1>
          <p className="mt-3 max-w-[60ch] text-[clamp(1rem,1.5vw,1.1rem)] text-on-surface-variant">
            <T path="compare.subtitle" />
          </p>
        </header>
        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <I18nProvider>
            <CompareClient />
          </I18nProvider>
        </section>
      </main>
    </>
  );
}
