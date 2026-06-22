import Link from "next/link";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { PAD_X } from "./layout-tokens";
import en from "@/lib/i18n/dictionaries/en";
import { DEFAULT_LOCALE } from "@/lib/i18n";

// Footer chrome renders server-side in the default locale. `asOf` is locale-independent data.
export function Footer({ asOf }: { asOf?: string | null }) {
  const t = en;
  return (
    <footer className={`mt-auto border-t border-outline-variant py-8 ${PAD_X}`}>
      <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="inline-flex items-center gap-2 font-extrabold tracking-[-0.02em] text-on-surface">
          <span className="text-primary-fixed-dim" aria-hidden>
            ★
          </span>
          GitStarClub
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.78rem] text-on-surface-variant" aria-label="Footer">
          <Link href="/pulse" className="transition-colors hover:text-on-surface">
            {t.nav.pulse}
          </Link>
          <Link href="/rankings" className="transition-colors hover:text-on-surface">
            {t.nav.rankings}
          </Link>
          <Link href="/about" className="transition-colors hover:text-on-surface">
            {t.nav.about}
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-on-surface">
            {t.footer.privacy}
          </Link>
          <LanguageSwitcher locale={DEFAULT_LOCALE} />
        </nav>
      </div>
      <div className="mx-auto mt-4 w-full max-w-[68rem] font-mono text-[0.72rem] text-on-surface-variant">
        {t.footer.madeIn}
        {asOf ? ` · ${t.footer.dataThrough} ${asOf}` : ""}
        <span className="mt-2 block max-w-[72ch] leading-relaxed">
          Data from{" "}
          <a className="text-tertiary hover:text-primary" href="https://www.gharchive.org/" rel="noreferrer">
            GH Archive
          </a>
          , licensed under{" "}
          <a className="text-tertiary hover:text-primary" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">
            CC BY 4.0
          </a>
          , derived and transformed by GitStarClub. GitHub repository metadata and current star totals come from public GitHub APIs.
        </span>
      </div>
    </footer>
  );
}
