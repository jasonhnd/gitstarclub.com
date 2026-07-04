import type { ReactNode } from "react";
import { RootShell, rootMetadata, rootViewport } from "../../_shell/RootShell";
import { resolveLocaleSegment } from "../../_localized/routing";
import { toHreflang } from "@/lib/i18n/routing";

export const metadata = rootMetadata;
export const viewport = rootViewport;

export default async function LocaleRootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <RootShell lang={toHreflang(resolveLocaleSegment(locale))}>{children}</RootShell>;
}
