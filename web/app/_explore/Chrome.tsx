import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SearchBox } from "./SearchBox";
import { DEFAULT_LOCALE, type Dict, type Locale } from "@/lib/i18n";
import { chromeText, resolveChromePath, type ChromeKey } from "@/lib/i18n/client";
import { localizedPath } from "@/lib/i18n/routing";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const NAV_LINK_CLASS = "font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface";
const MOBILE_LINK_CLASS =
  "flex min-h-11 items-center rounded-xl px-3 font-mono text-[0.82rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface";

type ChromeProps = {
  tag?: string;
  locale?: Locale;
  canonicalPath: string;
  dictionary?: Dict;
};

function label(dictionary: Dict | undefined, path: ChromeKey): string {
  return dictionary ? resolveChromePath(dictionary, path) : chromeText(path);
}

// Top chrome. Server-rendered with route-locale links. `tag` is an optional locale-independent badge.
export function Chrome({ tag, locale = DEFAULT_LOCALE, canonicalPath, dictionary }: ChromeProps) {
  const href = (path: string) => localizedPath(locale, path);
  return (
    <header
      className={`app-bar sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-outline-variant bg-surface/70 pb-[0.85rem] backdrop-blur-lg backdrop-saturate-150 sm:flex-nowrap sm:gap-4 ${PAD_X}`}
    >
      <Link href={href("/")} className="inline-flex min-w-0 shrink-0 items-center gap-2 text-[1.15rem] font-extrabold text-on-surface">
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
      <nav className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center justify-end gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-4 sm:gap-y-2" aria-label={label(dictionary, "a11y.primary")}>
        <SearchBox
          locale={locale}
          labels={{
            label: label(dictionary, "search.label"),
            placeholder: label(dictionary, "search.placeholder"),
            empty: label(dictionary, "search.empty"),
            loading: label(dictionary, "search.loading"),
            error: label(dictionary, "search.error"),
            retry: label(dictionary, "search.retry"),
            addToCompare: label(dictionary, "compare.addToCompare"),
            openCompare: label(dictionary, "compare.openCompare"),
          }}
        />
        <Link href={href("/pulse")} className={`hidden sm:inline ${NAV_LINK_CLASS}`}>
          {label(dictionary, "nav.pulse")}
        </Link>
        <Link href={href("/rankings")} className={`hidden sm:inline ${NAV_LINK_CLASS}`}>
          {label(dictionary, "nav.rankings")}
        </Link>
        <Link href={href("/categories")} className={`hidden md:inline ${NAV_LINK_CLASS}`}>
          {label(dictionary, "nav.categories")}
        </Link>
        <Link href={href("/compare")} className={`hidden sm:inline ${NAV_LINK_CLASS}`}>
          {label(dictionary, "nav.compare")}
        </Link>
        <Link href={href("/about")} className={`hidden sm:inline ${NAV_LINK_CLASS}`}>
          {label(dictionary, "nav.about")}
        </Link>
        <LanguageSwitcher locale={locale} canonicalPath={canonicalPath} label={label(dictionary, "a11y.language")} />
        <ThemeToggle label={label(dictionary, "a11y.switchTheme")} />
        <MobileNav locale={locale} dictionary={dictionary} />
      </nav>
    </header>
  );
}

function MobileNav({ locale, dictionary }: { locale: Locale; dictionary?: Dict }) {
  const links = [
    { href: localizedPath(locale, "/pulse"), label: label(dictionary, "nav.pulse") },
    { href: localizedPath(locale, "/rankings"), label: label(dictionary, "nav.rankings") },
    { href: localizedPath(locale, "/categories"), label: label(dictionary, "nav.categories") },
    { href: localizedPath(locale, "/compare"), label: label(dictionary, "nav.compare") },
    { href: localizedPath(locale, "/about"), label: label(dictionary, "nav.about") },
  ];

  return (
    <details className="group relative shrink-0 sm:hidden">
      <summary
        className="grid size-11 cursor-pointer list-none place-items-center rounded-full bg-surface-container-high text-on-surface transition-[background,transform] duration-200 ease-[var(--ease-emphasized)] marker:content-none hover:bg-surface-container-highest active:scale-90 [&::-webkit-details-marker]:hidden"
        aria-label={label(dictionary, "a11y.primaryNavigation")}
      >
        <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border border-outline-variant bg-surface/95 p-1.5 shadow-[var(--elev-2)] backdrop-blur-lg">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={MOBILE_LINK_CLASS}>
            {link.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
