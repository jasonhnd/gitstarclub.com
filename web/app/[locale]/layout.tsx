import type { ReactNode } from "react";
import { generateCoreLocaleStaticParams, resolveRouteLocale, type LocaleParams } from "../_localized/routing";

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: LocaleParams }) {
  await resolveRouteLocale(params);
  return children;
}
