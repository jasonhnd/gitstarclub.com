import Link from "next/link";
import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { T } from "@/lib/i18n/client";
import { pageMeta } from "@/lib/seo";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "About — Data Sources & Methodology",
    description:
      "How GitStarClub charts GitHub star history: data from GH Archive & GitHub API, gross vs net stars, the ≥10k whitelist, and known caveats.",
    path: "/about",
    locale: "en",
  });
}

function Section({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10 max-w-[58ch]">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{heading}</h2>
      <div className="flex flex-col gap-3 text-[1.02rem] leading-relaxed text-on-surface-variant">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <>
      <Chrome />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <p className="animate-rise font-mono text-[0.8rem] uppercase tracking-wider text-on-surface-variant">
          <T path="nav.about" />
        </p>
        <h1 className="mt-3 max-w-[16ch] animate-rise text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] tracking-[-0.035em]">
          <T path="about.heroPre" />
          <span className="hl">
            <T path="about.heroAccent" />
          </span>
          <T path="about.heroPost" />
        </h1>
        <p
          className="mt-5 max-w-[52ch] animate-rise text-[clamp(1.05rem,1.8vw,1.3rem)] text-on-surface-variant"
          style={{ animationDelay: "0.08s" }}
        >
          <T path="about.lead" />
        </p>

        <Section heading={<T path="about.s1h" />}>
          <p>
            <T path="about.s1pPre" />
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/">
              GH Archive
            </a>
            <T path="about.s1pPost" />
          </p>
        </Section>

        <Section heading={<T path="about.s2h" />}>
          <p>
            <strong className="text-on-surface">
              <T path="about.s2aStrong" />
            </strong>
            <T path="about.s2aBody" />
          </p>
          <p>
            <strong className="text-on-surface">
              <T path="about.s2bStrong" />
            </strong>
            <T path="about.s2bBody" />
          </p>
          <p>
            <strong className="text-on-surface">
              <T path="about.s2cStrong" />
            </strong>
            <T path="about.s2cBody" />
          </p>
        </Section>

        <Section heading={<T path="about.s3h" />}>
          <p>
            <T path="about.s3p" />
          </p>
        </Section>

        <div className="mt-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
          >
            ← <T path="about.back" />
          </Link>
        </div>
      </main>
    </>
  );
}
