import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SearchBox } from "./SearchBox";
import en from "@/lib/i18n/dictionaries/en";
import { DEFAULT_LOCALE } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

// Top chrome. Server-rendered in the default locale; interactive controls stay as
// small client islands. `tag` is an optional locale-independent badge.
export function Chrome({ tag }: { tag?: string }) {
  const t = en;
  return (
    <header
      className={`app-bar sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-outline-variant bg-surface/70 pb-[0.85rem] backdrop-blur-lg backdrop-saturate-150 ${PAD_X}`}
    >
      <Link href="/" className="inline-flex items-center gap-2 text-[1.15rem] font-extrabold text-on-surface">
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
      <nav className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-4" aria-label="Primary">
        <SearchBox
          labels={{
            label: t.search.label,
            placeholder: t.search.placeholder,
            empty: t.search.empty,
            loading: t.search.loading,
            addToCompare: t.compare.addToCompare,
            openCompare: t.compare.openCompare,
          }}
        />
        <Link href="/pulse" className="font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface">
          {t.nav.pulse}
        </Link>
        <Link href="/rankings" className="font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface">
          {t.nav.rankings}
        </Link>
        <Link href="/categories" className="hidden font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface md:inline">
          {t.nav.categories}
        </Link>
        <Link href="/compare" className="hidden font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline">
          {t.nav.compare}
        </Link>
        <Link href="/about" className="hidden font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline">
          {t.nav.about}
        </Link>
        <LanguageSwitcher locale={DEFAULT_LOCALE} />
        <ThemeToggle />
      </nav>
    </header>
  );
}
