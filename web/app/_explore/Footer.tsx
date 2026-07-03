import Link from "next/link";
import { CurrentPathLanguageSwitcher, LanguageSwitcher } from "../components/LanguageSwitcher";
import { PAD_X } from "./layout-tokens";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { chromeText, type ChromeKey } from "@/lib/i18n/client";
import { localizedPath } from "@/lib/i18n/routing";

type FooterProps = {
  asOf?: string | null;
  locale?: Locale;
  canonicalPath?: string;
};

function label(path: ChromeKey): string {
  return chromeText(path);
}

// Footer chrome renders server-side with route-locale links. `asOf` is locale-independent data.
export function Footer({ asOf, locale = DEFAULT_LOCALE, canonicalPath }: FooterProps) {
  const href = (path: string) => localizedPath(locale, path);
  return (
    <footer className={`mt-auto border-t border-outline-variant py-8 ${PAD_X}`}>
      <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href={href("/")} className="inline-flex items-center gap-2 font-extrabold tracking-[-0.02em] text-on-surface">
          <span className="text-primary-fixed-dim" aria-hidden>
            ★
          </span>
          GitStarClub
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.78rem] text-on-surface-variant" aria-label="Footer">
          <Link href={href("/pulse")} className="transition-colors hover:text-on-surface">
            {label("nav.pulse")}
          </Link>
          <Link href={href("/rankings")} className="transition-colors hover:text-on-surface">
            {label("nav.rankings")}
          </Link>
          <Link href={href("/categories")} className="transition-colors hover:text-on-surface">
            {label("nav.categories")}
          </Link>
          <Link href={href("/o")} className="transition-colors hover:text-on-surface">
            Organizations
          </Link>
          <Link href={href("/about")} className="transition-colors hover:text-on-surface">
            {label("nav.about")}
          </Link>
          <Link href={href("/privacy")} className="transition-colors hover:text-on-surface">
            {label("footer.privacy")}
          </Link>
          {canonicalPath ? <LanguageSwitcher locale={locale} canonicalPath={canonicalPath} /> : <CurrentPathLanguageSwitcher fallbackLocale={locale} />}
        </nav>
      </div>
      <div className="mx-auto mt-4 w-full max-w-[68rem] font-mono text-[0.72rem] text-on-surface-variant">
        {label("footer.madeIn")}
        {asOf ? ` · ${label("footer.dataThrough")} ${asOf}` : ""}
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
