import Link from "next/link";

export type Crumb = { label: string; href?: string };

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");

// Visible breadcrumb trail + BreadcrumbList JSON-LD (SEO §6.7). Last item is the current page.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: `${SITE}${c.href}` } : {}),
    })),
  };
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 font-mono text-[0.78rem] text-on-surface-variant">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-outline-variant">
                /
              </span>
            )}
            {c.href && !last ? (
              <Link href={c.href} className="transition-colors hover:text-on-surface">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "text-on-surface" : undefined}>{c.label}</span>
            )}
          </span>
        );
      })}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
    </nav>
  );
}
