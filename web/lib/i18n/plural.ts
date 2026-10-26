import { formatInteger } from "@/lib/format";
import type { Locale } from "./locales";

/** Cardinal pair. Locales with no plural split store the same word in both fields. */
export type PluralForms = {
  one: string;
  other: string;
};

const rules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  const cached = rules.get(locale);
  if (cached) return cached;
  const created = new Intl.PluralRules(locale);
  rules.set(locale, created);
  return created;
}

/**
 * Cardinal form for `count`.
 * English and Spanish use `one` only for 1. French (CLDR) uses `one` for 0 and 1.
 * Japanese, Chinese, and Korean always use `other`.
 */
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  return rulesFor(locale).select(count) === "one" ? forms.one : forms.other;
}

/** Locale-formatted count plus the matching noun, e.g. "1 repository" / "2 repositories". */
export function countWithNoun(locale: Locale, count: number, forms: PluralForms): string {
  return `${formatInteger(locale, count)} ${plural(locale, count, forms)}`;
}
