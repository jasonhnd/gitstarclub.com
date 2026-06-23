"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en, { type Dict } from "./dictionaries/en";
import { DEFAULT_LOCALE, LANG_COOKIE, LANGUAGE_CHANGE_EVENT, getDictionary, isLocale, type Locale } from ".";
import { resolveChromePath, type ChromeKey } from "./client";

type I18nState = { locale: Locale; t: Dict };

const I18nContext = createContext<I18nState>({ locale: DEFAULT_LOCALE, t: en });

export function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : undefined;
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<I18nState>({ locale: DEFAULT_LOCALE, t: en });

  useEffect(() => {
    let cancelled = false;
    const applyLocale = (locale: Locale) => {
      document.documentElement.lang = locale;
      void getDictionary(locale).then((t) => {
        if (!cancelled) setState({ locale, t });
      });
    };
    applyLocale(readLocaleCookie());
    const onLocaleChange = (event: Event) => {
      const locale = (event as CustomEvent<Locale>).detail;
      if (isLocale(locale)) applyLocale(locale);
    };
    window.addEventListener(LANGUAGE_CHANGE_EVENT, onLocaleChange);
    return () => {
      cancelled = true;
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, onLocaleChange);
    };
  }, []);

  return <I18nContext.Provider value={state}>{children}</I18nContext.Provider>;
}

export function useDict(): I18nState {
  return useContext(I18nContext);
}

export function useChrome(path: ChromeKey): string {
  const { t } = useDict();
  return resolveChromePath(t, path);
}

export function useChromeMemo<T>(fn: (t: Dict, locale: Locale) => T): T {
  const { t, locale } = useDict();
  return useMemo(() => fn(t, locale), [t, locale, fn]);
}
