"use client";

import { usePathname } from "next/navigation";
import { DEFAULT_LOCALE, LANGUAGE_LABELS, LOCALES, type Locale } from "@/lib/i18n/locales";
import { localizedPath, stripLocale } from "@/lib/i18n/routing";

function shortLocale(locale: Locale): string {
  return locale === "zh-TW" ? "TW" : locale.toUpperCase();
}

export function CurrentPathLanguageSwitcher({ fallbackLocale = DEFAULT_LOCALE, label }: { fallbackLocale?: Locale; label: string }) {
  const pathname = usePathname();
  const current = pathname ? stripLocale(pathname) : { locale: fallbackLocale, path: "/" };
  return <LanguageSwitcher locale={current.locale} canonicalPath={current.path} label={label} />;
}

export function LanguageSwitcher({ locale, canonicalPath, label }: { locale: Locale; canonicalPath: string; label: string }) {
  const canonical = stripLocale(canonicalPath).path;
  return (
    <details className="group relative shrink-0">
      <summary
        className="flex h-11 w-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-0 font-mono text-[0.72rem] font-medium text-on-surface-variant transition-colors marker:content-none hover:bg-surface-container-high hover:text-on-surface sm:w-auto sm:justify-start sm:px-3 [&::-webkit-details-marker]:hidden"
        aria-label={label}
      >
        <span className="font-semibold uppercase sm:hidden">{shortLocale(locale)}</span>
        <span className="hidden max-w-[6rem] truncate sm:inline">{LANGUAGE_LABELS[locale]}</span>
        <span className="hidden text-[0.65rem] opacity-70 transition-transform group-open:rotate-180 sm:inline" aria-hidden>
          v
        </span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-44 max-w-[min(12rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-outline-variant bg-surface/95 p-1.5 shadow-[var(--elev-2)] backdrop-blur-lg">
        {LOCALES.map((l) => (
          <a
            key={l}
            href={localizedPath(l, canonical)}
            className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 font-mono text-[0.75rem] transition-colors hover:bg-surface-container-high hover:text-on-surface ${
              l === locale ? "text-on-surface" : "text-on-surface-variant"
            }`}
            lang={l}
            aria-current={l === locale ? "true" : undefined}
          >
            {LANGUAGE_LABELS[l]}
          </a>
        ))}
      </div>
    </details>
  );
}
