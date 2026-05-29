import Link from "next/link";
import { Chrome } from "../_explore/Chrome";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const metadata = {
  title: "About — gitstarclub",
  description: "How gitstarclub measures open source, and the honest caveats behind the data.",
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 max-w-[58ch]">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{heading}</h2>
      <div className="flex flex-col gap-3 text-[1.02rem] leading-relaxed text-on-surface-variant">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <p className="animate-rise font-mono text-[0.8rem] uppercase tracking-wider text-on-surface-variant">
          About
        </p>
        <h1 className="mt-3 max-w-[16ch] animate-rise text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] tracking-[-0.035em]">
          An honest <span className="hl">chronicle</span>.
        </h1>
        <p
          className="mt-5 max-w-[52ch] animate-rise text-[clamp(1.05rem,1.8vw,1.3rem)] text-on-surface-variant"
          style={{ animationDelay: "0.08s" }}
        >
          gitstarclub indexes every public repo above 10,000 stars and reconstructs when each one rose
          — month by month, year by year, since 2015.
        </p>

        <Section heading="Where the data comes from">
          <p>
            History is reconstructed from{" "}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/">
              GH Archive
            </a>{" "}
            (every public GitHub event since 2015). Current totals come from the official GitHub GraphQL
            &amp; Search APIs. We only show public data about public repositories.
          </p>
        </Section>

        <Section heading="The honest caveats">
          <p>
            <strong className="text-on-surface">Two measuring sticks.</strong> The historical curve counts{" "}
            <em>gross</em> stars added (GH Archive watch events); the live daily delta is{" "}
            <em>net</em> (it can go down when stars are removed). The seam between them is slightly
            inconsistent — star-history.com has the same limitation. Current totals are always anchored to
            the authoritative GitHub count.
          </p>
          <p>
            <strong className="text-on-surface">Survivor bias.</strong> We backfill only repos that are
            ≥10k stars <em>today</em>. Projects that rose and faded are missing from the history.
          </p>
          <p>
            <strong className="text-on-surface">Why 2015?</strong> Before late 2012, GitHub&rsquo;s
            &ldquo;watch&rdquo; wasn&rsquo;t the same as a star; data stabilizes in 2015, our start of the
            modern open-source era.
          </p>
        </Section>

        <Section heading="Time">
          <p>
            Everything is stored in UTC and aggregated on UTC day boundaries. Wherever an exact moment is
            shown, both UTC and JST (Japan time) appear — gitstarclub is made in Tokyo.
          </p>
        </Section>

        <div className="mt-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
          >
            ← Back to the chronicle
          </Link>
        </div>
      </main>
    </>
  );
}
