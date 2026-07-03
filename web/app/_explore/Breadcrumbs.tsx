import Link from "next/link";
import { DEFAULT_LOCALE, type Dict, type Locale } from "@/lib/i18n";
import { chromeText, resolveChromePath, type ChromeKey } from "@/lib/i18n/client";
import { localizedPath } from "@/lib/i18n/routing";
import { stringifyJsonForScript } from "@/lib/json-script";

// A crumb is either a chrome label (`path`) or a data label
// (already-resolved string, e.g. a repo owner or a year). Data labels are locale-independent.
export type Crumb = { label?: string; path?: ChromeKey; href?: string };

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");

// Visible breadcrumb trail + BreadcrumbList JSON-LD (SEO §6.7). Last item is the current page.
// Rendered server-side with route-locale links; data crumbs are passed as plain labels.
// The static HTML stays deterministic and SEO-valid.
export function Breadcrumbs({ items, locale = DEFAULT_LOCALE, dictionary }: { items: Crumb[]; locale?: Locale; dictionary?: Dict }) {
  const labelOf = (c: Crumb): string => (c.path ? (dictionary ? resolveChromePath(dictionary, c.path) : chromeText(c.path)) : (c.label ?? ""));
  const hrefOf = (c: Crumb): string | undefined => (c.href ? localizedPath(locale, c.href) : undefined);

  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => {
      const href = hrefOf(c);
      return {
        "@type": "ListItem",
        position: i + 1,
        name: labelOf(c),
        ...(href ? { item: `${SITE}${href}` } : {}),
      };
    }),
  };
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 font-mono text-[0.78rem] text-on-surface-variant">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        const label = labelOf(c);
        const href = hrefOf(c);
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-outline-variant">
                /
              </span>
            )}
            {href && !last ? (
              <Link href={href} className="transition-colors hover:text-on-surface">
                {label}
              </Link>
            ) : (
              <span className={last ? "text-on-surface" : undefined}>{label}</span>
            )}
          </span>
        );
      })}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: stringifyJsonForScript(ld) }} />
    </nav>
  );
}
