import type { ReactNode } from "react";
import { RootShell, rootMetadata, rootViewport } from "../../_shell/RootShell";
import { resolveLocaleSegment } from "../../_localized/routing";
import { getDictionary } from "@/lib/i18n";
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
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleSegment(rawLocale);
  const dictionary = await getDictionary(locale);
  return (
    <RootShell lang={toHreflang(locale)} locale={locale} dictionary={dictionary}>
      {children}
    </RootShell>
  );
}
