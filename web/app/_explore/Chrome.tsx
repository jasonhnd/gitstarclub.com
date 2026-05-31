import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { localePrefix, LOCALES, type Locale } from "@/lib/i18n";
import en, { type Dict } from "@/lib/i18n/dictionaries/en";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export function Chrome({ tag, locale = "en", t = en }: { tag?: string; locale?: Locale; t?: Dict }) {
  const lp = localePrefix(locale);
  return (
    <header
      className={`app-bar sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-outline-variant bg-surface/70 pb-[0.85rem] backdrop-blur-lg backdrop-saturate-150 ${PAD_X}`}
    >
      <Link href={`${lp}/`} className="inline-flex items-center gap-2 text-[1.15rem] font-extrabold tracking-[-0.02em] text-on-surface">
        <span className="text-[1.05em] text-primary-fixed-dim" aria-hidden="true">
          ★
        </span>
        GitStarClub
        {tag ? (
          <span className="ml-1 rounded-full bg-primary-container px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-on-primary-container">
            {tag}
          </span>
        ) : null}
      </Link>
      <nav className="inline-flex items-center gap-4" aria-label="Primary">
        <Link href={`${lp}/pulse`} className="font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface">
          {t.nav.trending}
        </Link>
        <Link href={`${lp}/rankings`} className="font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface">
          {t.nav.rankings}
        </Link>
        <Link href={`${lp}/about`} className="hidden font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline">
          {t.nav.about}
        </Link>
        <LangSwitcher locale={locale} />
        <ThemeToggle />
      </nav>
    </header>
  );
}

function LangSwitcher({ locale }: { locale: Locale }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem]" aria-label="Language">
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={localePrefix(l) || "/"}
          aria-current={l === locale ? "true" : undefined}
          className={l === locale ? "font-semibold text-on-surface" : "text-on-surface-variant transition-colors hover:text-on-surface"}
        >
          {l.toUpperCase()}
        </Link>
      ))}
    </span>
  );
}
