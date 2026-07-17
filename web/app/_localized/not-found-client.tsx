"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LocalizedNotFound } from "./not-found";
import en, { type Dict } from "@/lib/i18n/dictionaries/en";
import { DEFAULT_LOCALE, getDictionary, isLocale, type Locale } from "@/lib/i18n";

export function LocalizedNotFoundClient() {
  const params = useParams<{ locale?: string | string[] }>();
  const locale = routeLocale(params?.locale);
  const [dictionary, setDictionary] = useState<Dict>(en);

  useEffect(() => {
    let active = true;
    void getDictionary(locale).then((nextDictionary) => {
      if (active) setDictionary(nextDictionary);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  return <LocalizedNotFound locale={locale} dictionary={dictionary} />;
}

function routeLocale(value: string | string[] | undefined): Locale {
  return typeof value === "string" && isLocale(value) ? value : DEFAULT_LOCALE;
}
