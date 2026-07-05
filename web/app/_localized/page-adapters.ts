import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { resolveLocaleSegment } from "./routing";

type ParamsRecord = Record<string, string>;
type LocalizedParamsRecord = ParamsRecord & { locale: string };
type WithoutLocale<T extends LocalizedParamsRecord> = Omit<T, "locale">;

export interface ResolvedRoute<T extends ParamsRecord> {
  locale: Locale;
  params: T;
}

export async function resolveEnglishRoute<T extends ParamsRecord>(params: Promise<T>): Promise<ResolvedRoute<T>> {
  return { locale: DEFAULT_LOCALE, params: await params };
}

export async function resolveLocalizedRoute<T extends LocalizedParamsRecord>(
  params: Promise<T>,
): Promise<ResolvedRoute<WithoutLocale<T>>> {
  const resolved = await params;
  const { locale, ...routeParams } = resolved;
  return { locale: resolveLocaleSegment(locale), params: routeParams as WithoutLocale<T> };
}

export async function routeMetadata<T extends ParamsRecord>(
  route: Promise<ResolvedRoute<T>>,
  build: (locale: Locale, params: T) => Promise<Metadata>,
): Promise<Metadata> {
  const resolved = await route;
  return build(resolved.locale, resolved.params);
}

export async function routeView<T extends ParamsRecord>(
  route: Promise<ResolvedRoute<T>>,
  render: (locale: Locale, params: T) => ReactNode | Promise<ReactNode>,
): Promise<ReactNode> {
  const resolved = await route;
  return render(resolved.locale, resolved.params);
}
