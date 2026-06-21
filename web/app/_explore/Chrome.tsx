"use client";

import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SearchBox } from "./SearchBox";
import { PAD_X } from "./layout-tokens";
import { useDict } from "@/lib/i18n/client";

// Top chrome. Translated client-side: renders English in the static HTML, swaps to the
// cookie locale after hydration. `tag` is an optional locale-independent badge.
export function Chrome({ tag }: { tag?: string }) {
  const { locale, t } = useDict();
  const mobileLinks = [
    { href: "/pulse", label: t.nav.pulse },
    { href: "/rankings", label: t.nav.rankings },
    { href: "/categories", label: t.nav.categories },
    { href: "/compare", label: t.nav.compare },
    { href: "/about", label: t.nav.about },
  ];
  return (
    <header
      className={`app-bar sticky top-0 z-20 flex items-center justify-between gap-x-3 gap-y-2 border-b border-outline-variant bg-surface-bright/70 pb-[0.85rem] backdrop-blur-lg backdrop-saturate-150 ${PAD_X}`}
    >
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-[1.15rem] font-extrabold text-on-surface">
        <span className="text-[1.05em] text-primary-fixed-dim" aria-hidden="true">
          ★
        </span>
        GitStarClub
        {tag ? (
          <span className="ml-1 rounded-full border border-tertiary/35 bg-tertiary-container px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-on-tertiary-container">
            {tag}
          </span>
        ) : null}
      </Link>
      <nav className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-2 sm:gap-x-4" aria-label="Primary">
        <SearchBox />
        <Link href="/pulse" className="hidden min-h-11 items-center font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline-flex">
          {t.nav.pulse}
        </Link>
        <Link href="/rankings" className="hidden min-h-11 items-center font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline-flex">
          {t.nav.rankings}
        </Link>
        <Link href="/categories" className="hidden min-h-11 items-center font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface md:inline-flex">
          {t.nav.categories}
        </Link>
        <Link href="/compare" className="hidden min-h-11 items-center font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline-flex">
          {t.nav.compare}
        </Link>
        <Link href="/about" className="hidden min-h-11 items-center font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface sm:inline-flex">
          {t.nav.about}
        </Link>
        <details className="group relative shrink-0 sm:hidden">
          <summary
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-outline-variant bg-surface-container text-on-surface-variant transition-colors marker:content-none hover:bg-surface-container-high hover:text-on-surface [&::-webkit-details-marker]:hidden"
            aria-label="Menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-48 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-outline-variant bg-surface/95 p-1.5 shadow-[var(--elev-2)] backdrop-blur-lg">
            {mobileLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 items-center rounded-xl px-3 font-mono text-[0.78rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </details>
        <LanguageSwitcher locale={locale} />
        <ThemeToggle />
      </nav>
    </header>
  );
}
