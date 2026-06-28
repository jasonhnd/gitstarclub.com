// schema.org JSON-LD builders (SEO section 6). URLs are absolute against the canonical site base.
// BreadcrumbList lives in the Breadcrumbs component; these add the per-page-type schema.
import { categoryLanguageNamesFromRepository } from "@/lib/categories/rules";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");
const abs = (path: string) => `${SITE}${path}`;
export const SITE_ORGANIZATION_SAME_AS = ["https://github.com/jasonhnd/gitstarclub.com"] as const;

const SITE_ORG = {
  "@type": "Organization",
  name: "GitStarClub",
  url: SITE,
} as const;

type DateModifiedOptions = {
  dateModified?: string | null;
};

type PageLdOptions = DateModifiedOptions & {
  about?: object | null;
};

type DatasetLdOptions = DateModifiedOptions & {
  name: string;
  path: string;
  locale: string;
  description: string;
  keywords?: string[];
  temporalCoverage?: string;
  variableMeasured?: string[];
  measurementTechnique?: string;
};

const DEFAULT_DATASET_VARIABLES = [
  "current_stars",
  "current_stars_sum",
  "rank item value (flow stars added)",
  "curve.monthly total_end",
  "milestones.crossed_10k",
  "milestones.crossed_50k",
  "milestones.crossed_100k",
] as const;

const DEFAULT_MEASUREMENT_TECHNIQUE =
  "GitHub public API current totals plus GH Archive WatchEvent history, reconciled through deterministic seam-aware anchoring.";

function optionalDateModified(dateModified: string | null | undefined) {
  return dateModified ? { dateModified } : {};
}

function optionalAbout(about: object | null | undefined) {
  return about ? { about } : {};
}

export function datasetRef(path: string) {
  return { "@id": `${abs(path)}#dataset` };
}

export function siteOrganizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "GitStarClub",
    url: SITE,
    logo: abs("/icon-512.png"),
    sameAs: [...SITE_ORGANIZATION_SAME_AS],
  };
}

export function datasetLd({
  name,
  path,
  locale,
  description,
  dateModified,
  keywords,
  temporalCoverage,
  variableMeasured = [...DEFAULT_DATASET_VARIABLES],
  measurementTechnique = DEFAULT_MEASUREMENT_TECHNIQUE,
}: DatasetLdOptions) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    ...datasetRef(path),
    name,
    description,
    url: abs(path),
    inLanguage: locale,
    creator: SITE_ORG,
    publisher: SITE_ORG,
    isAccessibleForFree: true,
    license: "https://creativecommons.org/licenses/by/4.0/",
    ...optionalDateModified(dateModified),
    ...(keywords?.length ? { keywords } : {}),
    ...(temporalCoverage ? { temporalCoverage } : {}),
    variableMeasured: variableMeasured.map((name) => ({
      "@type": "PropertyValue",
      name,
    })),
    measurementTechnique,
  };
}

export function webSiteLd(locale: string, path: string, options: PageLdOptions = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "GitStarClub",
    url: abs(path),
    inLanguage: locale,
    description: "GitHub star history & trends across 5,300+ repositories with ≥10k stars.",
    ...optionalDateModified(options.dateModified),
    ...optionalAbout(options.about),
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
  options: DateModifiedOptions = {},
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
    ...optionalDateModified(options.dateModified),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/LikeAction",
      userInteractionCount: repo.current_stars,
    },
  };
}

export function orgLd(org: { login: string; owner_type: string }, path: string, locale: string, options: DateModifiedOptions = {}) {
  return {
    "@context": "https://schema.org",
    "@type": org.owner_type === "Organization" ? "Organization" : "Person",
    name: org.login,
    url: abs(path),
    sameAs: `https://github.com/${org.login}`,
    inLanguage: locale,
    ...optionalDateModified(options.dateModified),
  };
}

export function collectionLd(name: string, path: string, locale: string, options: PageLdOptions = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url: abs(path),
    inLanguage: locale,
    ...optionalDateModified(options.dateModified),
    ...optionalAbout(options.about),
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

export type FaqItem = {
  question: string;
  answer: string;
};

export function faqPageLd(items: readonly FaqItem[], path: string, locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: abs(path),
    inLanguage: locale,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
