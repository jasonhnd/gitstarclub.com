import type { ReactNode } from "react";
import { RootShell, rootMetadata, rootViewport } from "../_shell/RootShell";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { toHreflang } from "@/lib/i18n/routing";

export const metadata = rootMetadata;
export const viewport = rootViewport;

export default function EnglishRootLayout({ children }: { children: ReactNode }) {
  return <RootShell lang={toHreflang(DEFAULT_LOCALE)}>{children}</RootShell>;
}
