import type { CategoryDimensionRegistry, CategoryRegistry, CategoryRegistryEntry, Meta, OrgEntity, RepoEntity } from "@/lib/contracts";
import { fmtStars, formatInteger, intlLocaleTag, monthYearLabel } from "@/lib/format";

export const ANSWER_CAPSULE_SOURCE = "GitStarClub";

export type AnswerCapsuleContent = {
  text: string;
  asOf: string;
  source: typeof ANSWER_CAPSULE_SOURCE;
};

export type VisibleCapsuleLabels = {
  answerCapsule: string;
  dataAsOf: string;
  source: string;
};

export type CapsuleRankRow = {
  owner: string;
  name: string;
  gained?: number;
  total?: number;
};

export type CapsuleOrgRankRow = {
  login: string;
  current_stars_sum: number;
  repo_count: number;
};

type RankingMetric = "gained" | "total";
type DataAsOfCandidate = string | null | undefined;
type DataAsOfOptions = { locale?: string };
type DataAsOfArg = DataAsOfCandidate | DataAsOfOptions;

const SOURCE_SUFFIX = ` — ${ANSWER_CAPSULE_SOURCE}`;

export function formatDataAsOf(value: string | null | undefined, locale = "en"): string | null {
  if (!value) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (date) {
    return formatUtcDate(Number(date[1]), Number(date[2]), Number(date[3]), locale);
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    return monthYearLabel(locale, Number(month[1]), Number(month[2]));
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(value);
  if (week) {
    return `${week[1]} week ${Number(week[2])}`;
  }
  if (/^\d{4}$/.test(value)) return value;
  return null;
}

export function dataAsOfLabel(...args: DataAsOfArg[]): string {
  const { candidates, locale } = dataAsOfArgs(args);
  const label = resolveDataAsOfLabel(...candidates, { locale });
  if (label) return label;
  throw new Error("GEO answer capsule requires a real data-as-of date from precomputed metadata.");
}

export function resolveDataAsOfLabel(...args: DataAsOfArg[]): string | null {
  const { candidates, locale } = dataAsOfArgs(args);
  for (const candidate of candidates) {
    const label = formatDataAsOf(candidate, locale);
    if (label) return label;
  }
  return null;
}

export function resolveDataAsOfValue(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && formatDataAsOf(candidate)) return candidate;
  }
  return null;
}

export function dataAsOfFromMeta(meta: Meta | null | undefined, ...args: DataAsOfArg[]): string {
  const { candidates: fallbacks, locale } = dataAsOfArgs(args);
  return dataAsOfLabel(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, ...fallbacks, { locale });
}

export function resolveDataAsOfFromMeta(meta: Meta | null | undefined, ...args: DataAsOfArg[]): string | null {
  const { candidates: fallbacks, locale } = dataAsOfArgs(args);
  return resolveDataAsOfLabel(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, ...fallbacks, { locale });
}

export function buildRepoCapsule(repo: RepoEntity, asOf: string, locale = "en"): AnswerCapsuleContent {
  const latest = repo.monthly_table.at(-1);
  const language = repo.language ? `${repo.language} ` : "";
  const latestPhrase = latest ? `${monthYearLabel(locale, Number(latest.month.slice(0, 4)), Number(latest.month.slice(5, 7)))} with ${signedStars(latest.adds)} stars` : "its latest precomputed monthly row";
  const text = withSource(
    `As of ${asOf}, ${repo.full_name} has ${fmtStars(repo.current_stars)} GitHub stars. GitStarClub tracks its ${language}profile, ${repoMilestonePhrase(repo, locale)}, and latest recorded month of ${latestPhrase}, combining identity, milestone, current-star, and monthly curve fields for answerable repository history without runtime inference.`,
  );
  return capsule(text, asOf);
}

export function buildOrgCapsule(org: OrgEntity, asOf: string, locale = "en"): AnswerCapsuleContent {
  const kind = org.owner_type === "Organization" ? "organization" : "developer";
  const text = withSource(
    `As of ${asOf}, ${org.login} has ${fmtStars(org.current_stars_sum)} total GitHub stars across ${formatInteger(locale, org.repo_count)} tracked repositories. GitStarClub builds this ${kind} page from precomputed organization JSON, member repository ids, current-star sums, and monthly curves so readers can cite organization momentum without a runtime database.`,
  );
  return capsule(text, asOf);
}

export function buildRankingCapsule({
  title,
  asOf,
  rows,
  metric,
}: {
  title: string;
  asOf: string;
  rows: CapsuleRankRow[];
  metric: RankingMetric;
}): AnswerCapsuleContent {
  const [first, second, third] = rows;
  const leader = first ? `${repoName(first)} leads with ${rankValue(first, metric)}` : "the visible list is waiting for rank rows";
  const followers = second && third ? `, followed by ${repoName(second)} and ${repoName(third)}` : "";
  const metricLabel = metric === "total" ? "current total stars" : "stars gained";
  const text = withSource(
    `As of ${asOf}, ${title} ranks tracked GitHub repositories by ${metricLabel}. ${leader}${followers}. GitStarClub generates this visible ranking from precomputed rank JSON and lookup joins, with no runtime search, database, or AI.`,
  );
  return capsule(text, asOf);
}

export function buildAllTimeRankingCapsule({
  asOf,
  repoRows,
  orgRows,
}: {
  asOf: string;
  repoRows: CapsuleRankRow[];
  orgRows: CapsuleOrgRankRow[];
}): AnswerCapsuleContent {
  const repoLead = repoRows[0] ? `${repoName(repoRows[0])} leads repositories with ${rankValue(repoRows[0], "total")}` : "the repository list is waiting for rows";
  const orgLead = orgRows[0] ? `${orgRows[0].login} leads organizations with ${fmtStars(orgRows[0].current_stars_sum)} total stars` : "the organization list is waiting for rows";
  const text = withSource(
    `As of ${asOf}, GitStarClub's all-time rankings summarize the largest tracked GitHub repositories and organizations. ${repoLead}, while ${orgLead}. The page is built from precomputed all-time rank JSON plus repository and organization lookup fields.`,
  );
  return capsule(text, asOf);
}

export function buildCategoryIndexCapsule(registry: CategoryRegistry, asOf: string, locale = "en"): AnswerCapsuleContent {
  const publicCategories = registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
  const labels = registry.dimensions.slice(0, 3).map((dimension) => dimension.label.toLowerCase()).join(", ");
  const text = withSource(
    `As of ${asOf}, GitStarClub organizes tracked GitHub repositories into ${formatInteger(locale, publicCategories.length)} public categories across ${formatInteger(locale, registry.dimensions.length)} dimensions, including ${labels}. These links come from deterministic category registry JSON and help readers reach focused repository lists without relying only on sitemap discovery.`,
  );
  return capsule(text, asOf);
}

export function buildCategoryDimensionCapsule(dimension: CategoryDimensionRegistry, asOf: string, locale = "en"): AnswerCapsuleContent {
  const publicCategories = dimension.categories.filter((category) => category.public);
  const text = withSource(
    `As of ${asOf}, GitStarClub lists ${formatInteger(locale, publicCategories.length)} public categories in the ${dimension.label.toLowerCase()} dimension for tracked GitHub repositories. This dimension page is generated from category registry JSON, with deterministic counts and crawlable links so readers and answer engines can move from broad taxonomy to specific repository rankings.`,
  );
  return capsule(text, asOf);
}

export function buildCategoryDetailCapsule({
  category,
  asOf,
  rows,
  locale = "en",
}: {
  category: CategoryRegistryEntry;
  asOf: string;
  rows: CapsuleRankRow[];
  locale?: string;
}): AnswerCapsuleContent {
  const [first, second, third] = rows;
  const leader = first ? `${repoName(first)} leads with ${rankValue(first, "total")}` : "the category list is waiting for ranking rows";
  const followers = second && third ? `, followed by ${repoName(second)} and ${repoName(third)}` : "";
  const text = withSource(
    `As of ${asOf}, GitStarClub tracks ${formatInteger(locale, category.count)} repositories in ${category.label}. ${leader}${followers}. This category ranking is generated from deterministic category assignment JSON, all-time stock ranking data, and repository lookup fields, not live search or AI.`,
  );
  return capsule(text, asOf);
}

export function buildPulseCapsule({
  asOf,
  weekRows,
  monthRows,
}: {
  asOf: string;
  weekRows: CapsuleRankRow[];
  monthRows: CapsuleRankRow[];
}): AnswerCapsuleContent {
  const weekLead = weekRows[0] ? `${repoName(weekRows[0])} leads the latest available week with ${rankValue(weekRows[0], "gained")}` : "weekly movers are waiting for rank rows";
  const monthLead = monthRows[0] ? `${repoName(monthRows[0])} leads the current month-to-date list with ${rankValue(monthRows[0], "gained")}` : "monthly movers are waiting for rank rows";
  const text = withSource(
    `As of ${asOf}, GitStarClub Pulse summarizes current open-source momentum across tracked repositories. ${weekLead}, while ${monthLead}. The page is generated from hot-snapshot and rank JSON so the visible summary stays deterministic, dated, and free of runtime analysis.`,
  );
  return capsule(text, asOf);
}

export function buildCompareCapsule(asOf: string): AnswerCapsuleContent {
  const text = withSource(
    `As of ${asOf}, GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON. The static page explains absolute calendar history and 10k-aligned comparison without claiming client-only query-state facts as server-rendered evidence, keeping citation copy deterministic and reviewable.`,
  );
  return capsule(text, asOf);
}

export function capsuleWordCount(capsule: Pick<AnswerCapsuleContent, "text"> | string): number {
  const text = typeof capsule === "string" ? capsule : capsule.text;
  return text.replace(/[—/]/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

export function visibleCapsuleSnapshot(capsule: AnswerCapsuleContent, labels: VisibleCapsuleLabels): string {
  return [labels.answerCapsule, capsule.text, `${labels.dataAsOf}: ${capsule.asOf}`, `${labels.source}: ${capsule.source}`].join("\n");
}

function capsule(text: string, asOf: string): AnswerCapsuleContent {
  return { text, asOf, source: ANSWER_CAPSULE_SOURCE };
}

function withSource(text: string): string {
  return `${text}${SOURCE_SUFFIX}`;
}

function formatUtcDate(year: number, month: number, day: number, locale: string): string {
  return new Intl.DateTimeFormat(intlLocaleTag(locale), { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(Date.UTC(year, month - 1, day));
}

function repoMilestonePhrase(repo: RepoEntity, locale: string): string {
  const milestones = [
    ["10k", repo.milestones.crossed_10k],
    ["50k", repo.milestones.crossed_50k],
    ["100k", repo.milestones.crossed_100k],
  ] as const;
  const known = milestones.flatMap(([label, date]) => (date ? [`${label} in ${monthYearLabel(locale, Number(date.slice(0, 4)), Number(date.slice(5, 7)))}`] : []));
  if (known.length === 0) return "frozen 10k, 50k, and 100k milestone fields when available";
  if (known.length === 1) return known[0];
  return `${known.slice(0, -1).join(", ")}, and ${known.at(-1)}`;
}

function dataAsOfArgs(args: DataAsOfArg[]): { candidates: DataAsOfCandidate[]; locale: string } {
  const last = args.at(-1);
  if (isDataAsOfOptions(last)) {
    return { candidates: args.slice(0, -1) as DataAsOfCandidate[], locale: last.locale ?? "en" };
  }
  return { candidates: args as DataAsOfCandidate[], locale: "en" };
}

function isDataAsOfOptions(value: DataAsOfArg | undefined): value is DataAsOfOptions {
  return Boolean(value && typeof value === "object" && "locale" in value);
}

function repoName(row: CapsuleRankRow): string {
  return `${row.owner}/${row.name}`;
}

function rankValue(row: CapsuleRankRow, metric: RankingMetric): string {
  if (metric === "total") return `${fmtStars(row.total ?? 0)} total stars`;
  return `${signedStars(row.gained ?? 0)} stars`;
}

function signedStars(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value))}`;
}
