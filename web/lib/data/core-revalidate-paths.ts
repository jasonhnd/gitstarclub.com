import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/locales";

const CORE_SUFFIXES = [
  "",
  "/pulse",
  "/rankings",
  "/categories",
  "/about",
  "/o",
  "/compare",
  "/privacy",
] as const;

/** High-traffic catalog pages invalidated on publication. Long-tail repo/org stay on TTL. */
export function corePublicationRevalidatePaths(): string[] {
  const paths: string[] = [];
  for (const locale of LOCALES) {
    const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
    for (const suffix of CORE_SUFFIXES) {
      paths.push(`${prefix}${suffix}` || "/");
    }
  }
  return paths;
}
