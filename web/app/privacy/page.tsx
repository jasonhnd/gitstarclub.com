import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { pageMeta } from "@/lib/seo";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "Privacy",
    description: "GitStarClub privacy details: privacy-friendly Vercel Web Analytics, no tracking cookies, and only an essential language preference cookie.",
    path: "/privacy",
    locale: "en",
  });
}

export default function PrivacyPage() {
  return (
    <>
      <Chrome />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <p className="font-mono text-[0.8rem] uppercase tracking-wider text-on-surface-variant">Privacy</p>
        <h1 className="mt-3 max-w-[16ch] text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] text-on-surface">
          Privacy-first by default.
        </h1>
        <div className="mt-8 flex max-w-[62ch] flex-col gap-6 text-[1.02rem] leading-relaxed text-on-surface-variant">
          <section>
            <h2 className="mb-2 text-[1.2rem] font-extrabold text-on-surface">Analytics</h2>
            <p>
              GitStarClub uses Vercel Web Analytics to count page views in aggregate. It is cookieless and
              privacy-friendly: it does not set cookies, follow you across sites, fingerprint your device, or collect
              personal or profile data. There are no advertising pixels or third-party tracking scripts.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-[1.2rem] font-extrabold text-on-surface">Cookies and storage</h2>
            <p>
              The only cookie is <code className="font-mono text-on-surface">gsc_lang</code>, which stores your language
              preference. It is a first-party, functional preference cookie. Theme preference is stored locally in your
              browser and is not sent to the server.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-[1.2rem] font-extrabold text-on-surface">Data shown on the site</h2>
            <p>
              The site displays public GitHub repository data and derived star-history aggregates. It does not ask for an
              account and does not collect personal profile information from visitors.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
