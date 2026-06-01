import Link from "next/link";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { type Locale, type Dict } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export function Footer({ locale, t, asOf }: { locale: Locale; t: Dict; asOf?: string | null }) {
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
            {t.nav.trending}
          </Link>
          <Link href="/rankings" className="transition-colors hover:text-on-surface">
            {t.nav.rankings}
          </Link>
          <Link href="/about" className="transition-colors hover:text-on-surface">
            {t.nav.about}
          </Link>
          <LanguageSwitcher locale={locale} />
        </nav>
      </div>
      <div className="mx-auto mt-4 w-full max-w-[68rem] font-mono text-[0.72rem] text-on-surface-variant">
        {t.footer.madeIn}
        {asOf ? ` · ${t.footer.dataThrough} ${asOf}` : ""}
      </div>
    </footer>
  );
}
