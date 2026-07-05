"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import en, { type Dict } from "./dictionaries/en";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { resolveChromePath, type ChromeKey } from "./client";

type I18nState = { locale: Locale; t: Dict };

const I18nContext = createContext<I18nState>({ locale: DEFAULT_LOCALE, t: en });

export function I18nProvider({
  children,
  locale = DEFAULT_LOCALE,
  dictionary = en,
}: {
  children: ReactNode;
  locale?: Locale;
  dictionary?: Dict;
}) {
  const state = useMemo<I18nState>(() => ({ locale, t: dictionary }), [dictionary, locale]);

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
