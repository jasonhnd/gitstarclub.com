"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, LANG_COOKIE, LANGUAGE_CHANGE_EVENT, LANGUAGE_LABELS, LOCALES, isLocale, type Locale } from "@/lib/i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : undefined;
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

function shortLocale(locale: Locale): string {
  return locale === "zh-TW" ? "TW" : locale.toUpperCase();
}

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const active = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
      return () => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
    },
    readLocaleCookie,
    () => locale,
  );
  const otherLocales = LOCALES.filter((l) => l !== active);

  useEffect(() => {
    if (!pendingLocale) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANG_COOKIE}=${encodeURIComponent(pendingLocale)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
    document.documentElement.lang = pendingLocale;
    menuRef.current?.removeAttribute("open");
    window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: pendingLocale }));
  }, [pendingLocale]);

  function choose(next: Locale) {
    setPendingLocale(next);
  }

  return (
    <details ref={menuRef} className="group relative shrink-0">
      <summary
        className="flex h-11 w-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-0 font-mono text-[0.72rem] font-medium text-on-surface-variant transition-colors marker:content-none hover:bg-surface-container-high hover:text-on-surface sm:w-auto sm:justify-start sm:px-3 [&::-webkit-details-marker]:hidden"
        aria-label="Language"
      >
        <span className="font-semibold uppercase sm:hidden">{shortLocale(active)}</span>
        <span className="hidden max-w-[6rem] truncate sm:inline">{LANGUAGE_LABELS[active]}</span>
        <span className="hidden text-[0.65rem] opacity-70 transition-transform group-open:rotate-180 sm:inline" aria-hidden>
          v
        </span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-44 max-w-[min(12rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-outline-variant bg-surface/95 p-1.5 shadow-[var(--elev-2)] backdrop-blur-lg">
        {otherLocales.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => choose(l)}
            className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            lang={l}
          >
            {LANGUAGE_LABELS[l]}
          </button>
        ))}
      </div>
    </details>
  );
}
