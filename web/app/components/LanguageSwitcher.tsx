"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, LANGUAGE_LABELS, LOCALES, type Locale } from "@/lib/i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [isPending, startTransition] = useTransition();
  const active = pendingLocale ?? locale;
  const otherLocales = LOCALES.filter((l) => l !== active);

  useEffect(() => {
    if (!pendingLocale) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANG_COOKIE}=${encodeURIComponent(pendingLocale)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
    document.documentElement.lang = pendingLocale;
    menuRef.current?.removeAttribute("open");
    startTransition(() => router.refresh());
  }, [pendingLocale, router, startTransition]);

  function choose(next: Locale) {
    setPendingLocale(next);
  }

  return (
    <details ref={menuRef} className="group relative shrink-0">
      <summary
        className="flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-3 font-mono text-[0.72rem] font-medium text-on-surface-variant transition-colors marker:content-none hover:bg-surface-container-high hover:text-on-surface [&::-webkit-details-marker]:hidden"
        aria-label="Language"
      >
        <span className="max-w-[6rem] truncate">{LANGUAGE_LABELS[active]}</span>
        <span className="text-[0.65rem] opacity-70 transition-transform group-open:rotate-180" aria-hidden>
          v
        </span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-44 max-w-[min(12rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-outline-variant bg-surface/95 p-1.5 shadow-[var(--elev-2)] backdrop-blur-lg">
        {otherLocales.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => choose(l)}
            disabled={isPending}
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
