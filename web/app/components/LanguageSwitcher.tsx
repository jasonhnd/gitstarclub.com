"use client";

import { useState } from "react";
import { LOCALES, type Locale } from "@/lib/i18n";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const [active, setActive] = useState<Locale>(locale);

  function choose(next: Locale) {
    setActive(next);
    const nextUrl = `/api/lang?lang=${encodeURIComponent(next)}&next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    window.location.assign(nextUrl);
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem]" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          aria-current={l === active ? "true" : undefined}
          className={l === active ? "font-semibold text-on-surface" : "text-on-surface-variant transition-colors hover:text-on-surface"}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
