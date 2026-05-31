import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const loc = parseLang((await params).lang);
  if (!loc) return {};
  return pageMeta({
    title: "About — Data Sources & Methodology",
    description:
      "How GitStarClub charts GitHub star history: data from GH Archive & GitHub API, gross vs net stars, the ≥10k whitelist, and known caveats.",
    path: "/about",
    locale: loc,
  });
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 max-w-[58ch]">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{heading}</h2>
      <div className="flex flex-col gap-3 text-[1.02rem] leading-relaxed text-on-surface-variant">{children}</div>
    </section>
  );
}

export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const [t] = await Promise.all([getDictionary(loc)]);
  const lp = localePrefix(loc);

  return (
    <>
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <p className="animate-rise font-mono text-[0.8rem] uppercase tracking-wider text-on-surface-variant">{t.nav.about}</p>
        <h1 className="mt-3 max-w-[16ch] animate-rise text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] tracking-[-0.035em]">
          {t.about.heroPre}
          <span className="hl">{t.about.heroAccent}</span>
          {t.about.heroPost}
        </h1>
        <p
          className="mt-5 max-w-[52ch] animate-rise text-[clamp(1.05rem,1.8vw,1.3rem)] text-on-surface-variant"
          style={{ animationDelay: "0.08s" }}
        >
          {t.about.lead}
        </p>

        <Section heading={t.about.s1h}>
          <p>
            {t.about.s1pPre}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/">
              GH Archive
            </a>
            {t.about.s1pPost}
          </p>
        </Section>

        <Section heading={t.about.s2h}>
          <p>
            <strong className="text-on-surface">{t.about.s2aStrong}</strong>
            {t.about.s2aBody}
          </p>
          <p>
            <strong className="text-on-surface">{t.about.s2bStrong}</strong>
            {t.about.s2bBody}
          </p>
          <p>
            <strong className="text-on-surface">{t.about.s2cStrong}</strong>
            {t.about.s2cBody}
          </p>
        </Section>

        <Section heading={t.about.s3h}>
          <p>{t.about.s3p}</p>
        </Section>

        <div className="mt-12">
          <Link
            href={`${lp}/`}
            className="inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
          >
            ← {t.about.back}
          </Link>
        </div>
      </main>
    </>
  );
}
