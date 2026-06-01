import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { type Locale } from "@/lib/i18n";
import en, { type Dict } from "@/lib/i18n/dictionaries/en";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export function Chrome({ tag, locale = "en", t = en }: { tag?: string; locale?: Locale; t?: Dict }) {
  return (
    <header
      className={`app-bar sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-outline-variant bg-surface/70 pb-[0.85rem] backdrop-blur-lg backdrop-saturate-150 ${PAD_X}`}
    >
      <Link href="/" className="inline-flex items-center gap-2 text-[1.15rem] font-extrabold tracking-[-0.02em] text-on-surface">
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
        <Link href="/pulse" className="font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface">
          {t.nav.trending}
        </Link>
        <Link href="/rankings" className="font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface">
          {t.nav.rankings}
        </Link>
        <Link href="/about" className="hidden font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline">
          {t.nav.about}
        </Link>
        <LanguageSwitcher locale={locale} />
        <ThemeToggle />
      </nav>
    </header>
  );
}
