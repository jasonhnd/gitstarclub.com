// schema.org JSON-LD builders (SEO section 6). URLs are absolute against the canonical site base.
// BreadcrumbList lives in the Breadcrumbs component; these add the per-page-type schema.
import { categoryLanguageNamesFromRepository } from "@/lib/categories/rules";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");
const abs = (path: string) => `${SITE}${path}`;

export function webSiteLd(locale: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "GitStarClub",
    url: abs(path),
    inLanguage: locale,
    description: "GitHub star history & trends across 5,300+ repositories with ≥10k stars.",
  };
}

export function repoLd(
  repo: {
    full_name: string;
    language: string | null;
    languages?: Array<{ name: string; size?: number | null; color?: string | null }>;
    description: string | null;
    created_at: string;
    current_stars: number;
  },
  path: string,
  locale: string,
) {
  const programmingLanguages = categoryLanguageNamesFromRepository(repo).filter((language) => language !== "Unknown");
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: repo.full_name,
    url: abs(path),
    codeRepository: `https://github.com/${repo.full_name}`,
    inLanguage: locale,
    ...(programmingLanguages.length ? { programmingLanguage: programmingLanguages } : {}),
    ...(repo.description ? { description: repo.description } : {}),
    ...(repo.created_at ? { dateCreated: repo.created_at } : {}),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/LikeAction",
      userInteractionCount: repo.current_stars,
    },
  };
}

export function orgLd(org: { login: string; owner_type: string }, path: string, locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": org.owner_type === "Organization" ? "Organization" : "Person",
    name: org.login,
    url: abs(path),
    sameAs: `https://github.com/${org.login}`,
    inLanguage: locale,
  };
}

export function collectionLd(name: string, path: string, locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url: abs(path),
    inLanguage: locale,
  };
}

export function itemListLd(
  name: string,
  path: string,
  locale: string,
  items: Array<{ name: string; path: string }>,
  startPosition = 1,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: abs(path),
    inLanguage: locale,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: startPosition + index,
      item: {
        "@type": "Thing",
        name: item.name,
        url: abs(item.path),
      },
    })),
  };
}
