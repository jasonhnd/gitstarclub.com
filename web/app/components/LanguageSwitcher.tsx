"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { LANGUAGE_LABELS, LOCALES, type Locale } from "@/lib/i18n";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const nextPath = search ? `${pathname}?${search}` : pathname;
  const otherLocales = LOCALES.filter((l) => l !== locale);

  return (
    <details className="group relative shrink-0">
      <summary
        className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-3 font-mono text-[0.72rem] font-medium text-on-surface-variant transition-colors marker:content-none hover:bg-surface-container-high hover:text-on-surface [&::-webkit-details-marker]:hidden"
        aria-label="Language"
      >
        <span className="max-w-[6rem] truncate">{LANGUAGE_LABELS[locale]}</span>
        <span className="text-[0.65rem] opacity-70 transition-transform group-open:rotate-180" aria-hidden>
          v
        </span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-44 max-w-[min(12rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-outline-variant bg-surface/95 p-1.5 shadow-[var(--elev-2)] backdrop-blur-lg">
        {otherLocales.map((l) => (
          <a
            key={l}
            href={`/api/lang?lang=${encodeURIComponent(l)}&next=${encodeURIComponent(nextPath)}`}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            hrefLang={l}
          >
            {LANGUAGE_LABELS[l]}
          </a>
        ))}
      </div>
    </details>
  );
}
