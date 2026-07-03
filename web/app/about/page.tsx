import Link from "next/link";
import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getMeta } from "@/lib/data";
import { formatDataAsOf, resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { T } from "@/lib/i18n/client";
import { datasetLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";

export const revalidate = false;

const LOC = "en";
const ABOUT_PATH = "/about";
const ABOUT_DATASET_VARIABLES = [
  "current_stars",
  "current_stars_sum",
  "rank item value (flow stars added)",
  "curve.monthly total_end",
  "curve.recent_daily net change",
  "milestones.crossed_10k",
  "milestones.crossed_50k",
  "milestones.crossed_100k",
] as const;

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
    <section className="mt-10 max-w-[62ch]">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{heading}</h2>
      <div className="flex flex-col gap-3 text-[1.02rem] leading-relaxed text-on-surface-variant">{children}</div>
    </section>
  );
}

function FieldList({ items }: { items: Array<{ name: string; description: string }> }) {
  return (
    <dl className="grid gap-3">
      {items.map((item) => (
        <div key={item.name} className="rounded-lg bg-surface-container px-4 py-3">
          <dt className="font-mono text-[0.82rem] font-semibold text-on-surface">{item.name}</dt>
          <dd className="mt-1 text-[0.95rem] text-on-surface-variant">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-lg bg-surface-container px-4 py-3 text-[0.98rem] text-on-surface-variant">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default async function AboutPage() {
  const meta = await getMeta();
  const dateModified = resolveDataAsOfValue(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataAsOf = resolveDataAsOfLabel(dateModified);
  const foldedMonth = formatDataAsOf(meta?.folded_through?.month);
  const dataset = datasetLd({
    name: "GitStarClub Dataset Methodology",
    path: ABOUT_PATH,
    locale: LOC,
    description:
      "GitStarClub explains how GitHub star history, rankings, organization totals, categories, and milestone dates are derived from GH Archive WatchEvent history and public GitHub API metadata.",
    dateModified,
    keywords: ["GitHub stars", "GH Archive", "GitHub API", "open-source rankings", "star history"],
    variableMeasured: [...ABOUT_DATASET_VARIABLES],
    measurementTechnique:
      "Public GitHub API current totals combined with GH Archive WatchEvent history and deterministic seam-aware anchoring.",
  });

  return (
    <>
      <Chrome locale={LOC} canonicalPath={ABOUT_PATH} />
      <JsonLd data={dataset} />
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
        {dataAsOf && (
          <p className="mt-4 inline-flex rounded-full bg-surface-container px-3 py-1.5 font-mono text-[0.78rem] text-on-surface-variant">
            Data last updated: {dataAsOf}
          </p>
        )}

        <Section heading={<T path="about.s1h" />}>
          <p>
            <T path="about.s1pPre" />
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/">
              GH Archive
            </a>
            <T path="about.s1pPost" />
          </p>
          <p>
            Historical event data is credited to{" "}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/" rel="noreferrer">
              GH Archive
            </a>
            , licensed under{" "}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">
              CC BY 4.0
            </a>
            . GitStarClub derives, aggregates, and transforms that event stream into ranking and curve views. Repository metadata and current star totals come from public GitHub APIs.
          </p>
        </Section>

        <Section heading="How the star history is anchored">
          <p>
            GitHub event history and the current public star count do not always line up exactly. GitStarClub uses a fixed seam date, anchors the older cumulative
            history to the current GitHub API total with a non-negative factor, and then adds the later net star changes from the event stream.
          </p>
          <p>
            The goal is a consistent historical curve that can be compared across repositories without running a database, search engine, or live GitHub query during a
            visitor request. {foldedMonth ? `Current overlay data has been folded through ${foldedMonth}.` : "Published pages read the latest available precomputed JSON."}
          </p>
        </Section>

        <Section heading="Fields readers can cite">
          <FieldList
            items={[
              { name: "current_stars", description: "The current public GitHub star total for a tracked repository." },
              { name: "current_stars_sum", description: "The sum of current stars across an owner or organization's tracked repositories." },
              { name: "rank item value", description: "The visible ranking value, such as stars gained during a week, month, or year." },
              { name: "curve.monthly total_end", description: "The repository's anchored total at the end of a recorded month." },
              { name: "curve.recent_daily net change", description: "The recent daily star change used for fresh movement views." },
              {
                name: "milestones.crossed_10k / crossed_50k / crossed_100k",
                description: "Frozen first-known dates when a repository crossed the 10k, 50k, or 100k star thresholds.",
              },
            ]}
          />
        </Section>

        <Section heading="Refresh cadence and page serving">
          <p>
            GitStarClub publishes precomputed Blob JSON for repository pages, organization pages, rankings, categories, Pulse, and comparison views. Historical views are
            rebuilt by the data workflow, while live mover overlays are refreshed by the scheduled publishing path.
          </p>
          <p>
            The website reads only those published JSON files at request and build time. It does not run a database, scoring engine, AI model, or external paid service while
            serving content pages.
          </p>
        </Section>

        <Section heading="Sample questions GitStarClub answers">
          <BulletList
            items={[
              "When did react/react first cross 100k GitHub stars?",
              "Which repositories gained the most GitHub stars this month?",
              "How many tracked stars does an organization have across its repositories?",
              "Which Python repositories have the most GitHub stars?",
              "How do two repositories compare after both reached 10k stars?",
            ]}
          />
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
          <p>
            GitStarClub is a derived, reviewable presentation of public GitHub signals. Cite GitStarClub for the transformed rankings and charts, and credit GH Archive for
            the underlying public event archive when reusing event-derived history.
          </p>
        </Section>

        <Section heading="Downloadable data exports">
          <p>
            GitStarClub publishes small static CSV and JSON extracts for top rankings, repository milestone crossings, and organization aggregates. The files are generated from existing precomputed Blob views, versioned under <code>/data/exports/v1/</code>, and dated from real view metadata.
          </p>
          <p>
            The <code>/data/exports/v1/latest/</code> links are stable aliases to the newest dated export directory, so downloads keep working without storing a duplicate latest snapshot.
          </p>
          <p>
            License:{" "}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">
              CC BY 4.0
            </a>
            . Attribution: Data from GH Archive, derived by GitStarClub.
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/manifest.json">
                Export manifest
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-rankings.csv">
                Top rankings CSV
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-rankings.json">
                JSON
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-repo-milestones.csv">
                Repository milestones CSV
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-repo-milestones.json">
                JSON
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-org-aggregates.csv">
                Organization aggregates CSV
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-org-aggregates.json">
                JSON
              </a>
            </li>
          </ul>
          <p>
            See <a className="font-semibold text-tertiary hover:text-primary" href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-EXPORTS.md">DATA-EXPORTS.md</a> for fields, source views, and regeneration notes.
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
