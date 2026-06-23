import Link from "next/link";
import { chromeText, type ChromeKey } from "@/lib/i18n/client";
import { stringifyJsonForScript } from "@/lib/json-script";

// A crumb is either a chrome label (translated client-side via `path`) or a data label
// (already-resolved string, e.g. a repo owner or a year). Data labels are locale-independent.
export type Crumb = { label?: string; path?: ChromeKey; href?: string };

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");

// Visible breadcrumb trail + BreadcrumbList JSON-LD (SEO §6.7). Last item is the current page.
// Rendered server-side with default-locale chrome labels; data crumbs are passed as plain labels.
// The static HTML stays deterministic and SEO-valid.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const labelOf = (c: Crumb): string => (c.path ? chromeText(c.path) : (c.label ?? ""));

  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: labelOf(c),
      ...(c.href ? { item: `${SITE}${c.href}` } : {}),
    })),
  };
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 font-mono text-[0.78rem] text-on-surface-variant">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        const label = labelOf(c);
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-outline-variant">
                /
              </span>
            )}
            {c.href && !last ? (
              <Link href={c.href} className="transition-colors hover:text-on-surface">
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
