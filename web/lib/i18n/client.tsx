"use client";

// Client-side chrome i18n (option C).
//
// Why this exists: page BODIES are static (SSG/ISR) and the data they render is
// locale-independent. Only the CHROME — nav, footer, section/UI labels — is translated.
// The server therefore renders the DEFAULT locale (English) into the static HTML, which is
// valid and SEO-friendly. After hydration this provider reads the `gsc_lang` cookie in the
// browser and swaps the chrome strings to the user's preferred language.
//
// Hydration safety: the very first client render returns the SAME English dictionary the
// server emitted, so server and client markup match. The locale swap happens inside a
// `useEffect` (post-hydration), never during the initial render.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en, { type Dict } from "./dictionaries/en";
import { DEFAULT_LOCALE, LANG_COOKIE, getDictionary, isLocale, type Locale } from ".";

type I18nState = { locale: Locale; t: Dict };

const I18nContext = createContext<I18nState>({ locale: DEFAULT_LOCALE, t: en });

function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : undefined;
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start at the default locale so the first client render matches the server HTML.
  const [state, setState] = useState<I18nState>({ locale: DEFAULT_LOCALE, t: en });

  useEffect(() => {
    let cancelled = false;
    const locale = readLocaleCookie();
    if (locale === DEFAULT_LOCALE) return; // already correct; nothing to swap
    document.documentElement.lang = locale;
    void getDictionary(locale).then((t) => {
      if (!cancelled) setState({ locale, t });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <I18nContext.Provider value={state}>{children}</I18nContext.Provider>;
}

export function useDict(): I18nState {
  return useContext(I18nContext);
}

// Dotted-path resolver over the chrome dictionary, e.g. "rankings.title" or "nav.home".
// Only leaf string values are valid targets.
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type ChromeKey = Leaves<Dict>;

function resolve(t: Dict, path: string): string {
  // path is type-checked at call sites via ChromeKey; runtime guard keeps this total.
  const value = path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], t);
  return typeof value === "string" ? value : path;
}

export function useChrome(path: ChromeKey): string {
  const { t } = useDict();
  return resolve(t, path);
}

// Inline translated chrome text node. Renders default-locale English on the server (static),
// swaps to the cookie locale after hydration. Use anywhere a chrome label appears as text.
export function T({ path }: { path: ChromeKey }) {
  const { t } = useDict();
  return <>{resolve(t, path)}</>;
}

// For chrome labels composed with data (e.g. "Top repositories in {year}"): pass the
// translated piece by key and the surrounding data as children/props at the call site.
export function useChromeMemo<T>(fn: (t: Dict, locale: Locale) => T): T {
  const { t, locale } = useDict();
  return useMemo(() => fn(t, locale), [t, locale, fn]);
}
