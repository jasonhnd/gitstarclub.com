import type { Metadata } from "next";

// Per-page metadata helper. canonical/openGraph URLs are relative — resolved against
// metadataBase (root layout). Title runs through the root title.template (%s · gitstarclub)
// unless `absoluteTitle` is set (home). See docs/SEO.md §2.

export function pageMeta(opts: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: { url: opts.path, title: opts.title, description: opts.description },
  };
}
