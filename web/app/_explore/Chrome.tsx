import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SearchBox } from "./SearchBox";
import { DEFAULT_LOCALE, type Dict, type Locale } from "@/lib/i18n";
import { chromeText, resolveChromePath, type ChromeKey } from "@/lib/i18n/client";
import { localizedPath, stripLocale } from "@/lib/i18n/routing";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const NAV_LINK_BASE =
  "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 font-mono text-[0.78rem] font-semibold transition-[background,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-emphasized)] hover:-translate-y-0.5 lg:min-h-10";
const NAV_LINK_IDLE = "border-transparent text-on-surface-variant hover:border-outline-variant hover:bg-surface-container-high hover:text-on-surface";
const NAV_LINK_ACTIVE = "border-primary-container bg-primary-container text-on-primary-container shadow-[var(--elev-1)]";

const NAV_ITEMS = [
  { path: "/pulse", label: "nav.pulse" },
  { path: "/rankings", label: "nav.rankings" },
  { path: "/categories", label: "nav.categories" },
  { path: "/compare", label: "nav.compare" },
  { path: "/about", label: "nav.about" },
] as const satisfies readonly { path: string; label: ChromeKey }[];

type ChromeProps = {
  tag?: string;
  locale?: Locale;
  canonicalPath: string;
  dictionary?: Dict;
};

function label(dictionary: Dict | undefined, path: ChromeKey): string {
  return dictionary ? resolveChromePath(dictionary, path) : chromeText(path);
}

function pathOnly(path: string): string {
  return stripLocale(path).path.split(/[?#]/, 1)[0] || "/";
}

function isActiveRoute(current: string, itemPath: string): boolean {
  if (itemPath === "/pulse") return current === "/" || current === "/pulse";
  return current === itemPath || current.startsWith(`${itemPath}/`);
}

// Top chrome. Server-rendered with route-locale links. `tag` is an optional locale-independent badge.
export function Chrome({ tag, locale = DEFAULT_LOCALE, canonicalPath, dictionary }: ChromeProps) {
  const href = (path: string) => localizedPath(locale, path);
  const currentPath = pathOnly(canonicalPath);

  return (
    <header
      className={`app-bar sticky top-0 z-20 border-b border-outline-variant bg-surface/80 pb-[0.85rem] shadow-[var(--elev-1)] backdrop-blur-lg backdrop-saturate-150 ${PAD_X}`}
    >
      <div className="grid w-full min-w-0 gap-3 lg:grid-cols-[auto_minmax(13rem,26rem)_minmax(0,1fr)] lg:items-center lg:gap-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link href={href("/")} className="inline-flex min-w-0 shrink-0 items-center gap-2 text-[1.15rem] font-extrabold text-on-surface">
            <span className="text-[1.05em] text-primary-fixed-dim" aria-hidden="true">
              ★
            </span>
            <span className="truncate">GitStarClub</span>
            {tag ? (
              <span className="ml-1 shrink-0 rounded-full bg-primary-container px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-on-primary-container">
                {tag}
              </span>
            ) : null}
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <LanguageSwitcher locale={locale} canonicalPath={canonicalPath} label={label(dictionary, "a11y.language")} />
            <ThemeToggle label={label(dictionary, "a11y.switchTheme")} />
          </div>
        </div>

        <div className="min-w-0 lg:justify-self-start">
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
              removeFromCompare: label(dictionary, "compare.remove"),
              openCompare: label(dictionary, "compare.openCompare"),
            }}
          />
        </div>

        <div className="flex min-w-0 items-center gap-2 lg:justify-end">
          <nav
            className="nav-scroll-affordance min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-1 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-none lg:overflow-visible lg:py-0 lg:pr-0"
            aria-label={label(dictionary, "a11y.primary")}
          >
            <div className="flex min-w-max items-center gap-1.5 lg:min-w-0 lg:flex-wrap lg:justify-end lg:gap-x-2 lg:gap-y-1.5">
              {NAV_ITEMS.map((item) => {
                const active = isActiveRoute(currentPath, item.path);
                return (
                  <Link
                    key={item.path}
                    href={href(item.path)}
                    className={`${NAV_LINK_BASE} ${active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {label(dictionary, item.label)}
                  </Link>
                );
              })}
            </div>
          </nav>
          <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
            <LanguageSwitcher locale={locale} canonicalPath={canonicalPath} label={label(dictionary, "a11y.language")} />
            <ThemeToggle label={label(dictionary, "a11y.switchTheme")} />
          </div>
        </div>
      </div>
    </header>
  );
}
