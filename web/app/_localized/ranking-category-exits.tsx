import Link from "next/link";
import type { Dict, Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";
import type { CategoryLink } from "@/lib/repo-page";

export function RankingCategoryExits({
  locale,
  links,
  t,
}: {
  locale: Locale;
  links: readonly CategoryLink[];
  t: Dict;
}) {
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="ranking-category-exits" className="mt-[clamp(1.75rem,3.5vw,2.5rem)]">
      <div className="max-w-[64ch]">
        <h2 id="ranking-category-exits" className="text-[1.2rem] font-extrabold tracking-tight text-on-surface">
          {t.rankings.categoryExitsTitle}
        </h2>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-on-surface-variant">{t.rankings.categoryExits}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map((category) => (
          <Link
            key={category.id}
            href={localizedPath(locale, category.href)}
            className="inline-flex max-w-full items-center rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
          >
            <span className="truncate">{category.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
