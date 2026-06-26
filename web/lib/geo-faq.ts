import type { CategoryDimensionRegistry, CategoryRegistry, CategoryRegistryEntry, OrgEntity, RepoEntity } from "@/lib/contracts";
import { fmtStars, monthYearLabel } from "@/lib/format";
import type { CapsuleOrgRankRow, CapsuleRankRow } from "@/lib/geo-capsules";
import type { FaqItem } from "@/lib/jsonld";

type RankingMetric = "gained" | "total";

export function buildRepoFaqs(repo: RepoEntity, asOf: string | null): FaqItem[] {
  const latest = repo.curve.monthly.at(-1);
  const latestPhrase = latest
    ? `${monthLabel(latest[0])} recorded ${signedStars(latest[1])} stars and ended at ${fmtStars(latest[2])} total stars`
    : "the monthly curve is unavailable in the loaded repository JSON";
  const language = repo.language ?? "an unspecified primary language";

  return [
    {
      question: `How many GitHub stars does ${repo.full_name} have?`,
      answer: asOf
        ? `As of ${asOf}, ${repo.full_name} has ${fmtStars(repo.current_stars)} GitHub stars. GitStarClub reads that value from the precomputed repository entity JSON.`
        : `${repo.full_name} has ${fmtStars(repo.current_stars)} GitHub stars in the loaded repository JSON. GitStarClub omits a dated claim when no real metadata watermark is available.`,
    },
    {
      question: `What language and owner does GitStarClub show for ${repo.full_name}?`,
      answer: `${repo.full_name} is shown as a ${language} repository owned by ${repo.owner}. The page also links to the owner profile and matching category pages when those fields are present.`,
    },
    {
      question: `When did ${repo.full_name} cross major star milestones?`,
      answer: repoMilestoneAnswer(repo),
    },
    {
      question: `What is the latest monthly growth point for ${repo.full_name}?`,
      answer: `The latest precomputed monthly point for ${repo.full_name} says ${latestPhrase}. The chart and recent table are rendered from the same curve fields.`,
    },
    {
      question: `Does this repository FAQ use live search or AI?`,
      answer: `No. GitStarClub renders this repository FAQ from deterministic templates over Blob JSON already loaded by the server route, without runtime AI, search, or a database.`,
    },
  ];
}

export function buildOrgFaqs(org: OrgEntity, members: readonly CapsuleRankRow[], asOf: string | null): FaqItem[] {
  const kind = org.owner_type === "Organization" ? "organization" : "developer";
  const lead = members[0];
  const leadAnswer = lead
    ? `${repoName(lead)} is the top visible tracked repository for ${org.login} with ${rankValue(lead, "total")}.`
    : `No member repository rows are available in the loaded lookup data for ${org.login}.`;

  return [
    {
      question: `How many tracked stars does ${org.login} have?`,
      answer: asOf
        ? `As of ${asOf}, ${org.login} has ${fmtStars(org.current_stars_sum)} total GitHub stars across ${org.repo_count.toLocaleString("en-US")} tracked repositories.`
        : `${org.login} has ${fmtStars(org.current_stars_sum)} total GitHub stars across ${org.repo_count.toLocaleString("en-US")} tracked repositories in the loaded organization JSON.`,
    },
    {
      question: `Is ${org.login} an organization or developer page?`,
      answer: `GitStarClub classifies ${org.login} as a GitHub ${kind} page using the owner type stored in the precomputed organization entity JSON.`,
    },
    {
      question: `Which tracked repository leads ${org.login}?`,
      answer: leadAnswer,
    },
    {
      question: `How is the organization star total calculated?`,
      answer: `GitStarClub uses the precomputed organization aggregate, member repository ids, current-star sums, and monthly curves. It does not imply GitHub exposes a native organization star-count field.`,
    },
  ];
}

export function buildAllTimeRankingFaqs({
  asOf,
  repoRows,
  orgRows,
}: {
  asOf: string | null;
  repoRows: readonly CapsuleRankRow[];
  orgRows: readonly CapsuleOrgRankRow[];
}): FaqItem[] {
  const repoLead = repoRows[0];
  const orgLead = orgRows[0];

  return [
    {
      question: "What do the all-time GitHub star rankings show?",
      answer: asOf
        ? `As of ${asOf}, the all-time rankings list the largest tracked GitHub repositories and organizations by current total stars.`
        : "The all-time rankings list the largest tracked GitHub repositories and organizations by current total stars from precomputed ranking JSON.",
    },
    {
      question: "Which repository leads the all-time ranking?",
      answer: repoLead
        ? `${repoName(repoLead)} leads the visible repository ranking with ${rankValue(repoLead, "total")}.`
        : "The visible repository ranking is waiting for precomputed rank rows.",
    },
    {
      question: "Which organization leads the all-time ranking?",
      answer: orgLead
        ? `${orgLead.login} leads the visible organization ranking with ${fmtStars(orgLead.current_stars_sum)} total stars across ${orgLead.repo_count.toLocaleString("en-US")} tracked repositories.`
        : "The visible organization ranking is waiting for precomputed organization rank rows.",
    },
    {
      question: "What data powers the all-time ranking FAQ?",
      answer: "GitStarClub builds this FAQ from all-time rank JSON, repository lookup JSON, and organization lookup JSON already loaded by the server route.",
    },
  ];
}

export function buildRankingFaqs({
  title,
  asOf,
  rows,
  metric,
}: {
  title: string;
  asOf: string | null;
  rows: readonly CapsuleRankRow[];
  metric: RankingMetric;
}): FaqItem[] {
  const leader = rows[0];
  const second = rows[1];
  const metricPhrase = metric === "total" ? "current total stars" : "stars gained in the selected period";

  return [
    {
      question: `What does ${title} rank?`,
      answer: asOf
        ? `As of ${asOf}, ${title} ranks tracked GitHub repositories by ${metricPhrase}.`
        : `${title} ranks tracked GitHub repositories by ${metricPhrase} from precomputed rank JSON.`,
    },
    {
      question: `Which repository leads ${title}?`,
      answer: leader ? `${repoName(leader)} leads ${title} with ${rankValue(leader, metric)}.` : `The visible ${title} list is waiting for rank rows.`,
    },
    {
      question: second ? `Who follows ${repoName(leader ?? second)} in ${title}?` : `Does ${title} include runner-up repositories?`,
      answer: second ? `${repoName(second)} appears next in the visible ranking with ${rankValue(second, metric)}.` : `Runner-up rows appear when the precomputed ranking has at least two repositories.`,
    },
    {
      question: `Does ${title} use live database queries?`,
      answer: `No. GitStarClub renders ${title} from Blob rank JSON plus repository lookup JSON already loaded by the server route.`,
    },
  ];
}

export function buildCategoryIndexFaqs(registry: CategoryRegistry, asOf: string | null): FaqItem[] {
  const publicCategories = registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
  const firstDimension = registry.dimensions[0];

  return [
    {
      question: "What are GitHub repository categories on GitStarClub?",
      answer: asOf
        ? `As of ${asOf}, GitStarClub organizes tracked repositories into ${publicCategories.length.toLocaleString("en-US")} public categories across ${registry.dimensions.length} dimensions.`
        : `GitStarClub organizes tracked repositories into ${publicCategories.length.toLocaleString("en-US")} public categories across ${registry.dimensions.length} dimensions in the loaded registry JSON.`,
    },
    {
      question: "Which category dimensions are available?",
      answer: `The visible category dimensions are ${listLabels(registry.dimensions.map((dimension) => dimension.label))}.`,
    },
    {
      question: "Where do category counts come from?",
      answer: "Category counts come from deterministic category registry JSON generated from repository metadata and category rules, not from live search.",
    },
    {
      question: "How can readers move from categories to repositories?",
      answer: firstDimension
        ? `Readers can open a dimension such as ${firstDimension.label}, then follow a category link to a ranked repository list.`
        : "Readers can open any visible dimension, then follow a category link to a ranked repository list.",
    },
  ];
}

export function buildCategoryDimensionFaqs(dimension: CategoryDimensionRegistry, asOf: string | null): FaqItem[] {
  const publicCategories = dimension.categories.filter((category) => category.public);
  const largest = [...publicCategories].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];

  return [
    {
      question: `What does the ${dimension.label} category page include?`,
      answer: asOf
        ? `As of ${asOf}, the ${dimension.label} page lists ${publicCategories.length.toLocaleString("en-US")} public categories for tracked GitHub repositories.`
        : `The ${dimension.label} page lists ${publicCategories.length.toLocaleString("en-US")} public categories for tracked GitHub repositories from registry JSON.`,
    },
    {
      question: `Which ${dimension.label} category has the most tracked repositories?`,
      answer: largest
        ? `${largest.label} is the largest visible ${dimension.label} category with ${largest.count.toLocaleString("en-US")} tracked repositories.`
        : `No public ${dimension.label} category counts are available in the loaded registry JSON.`,
    },
    {
      question: `How are ${dimension.label} category links generated?`,
      answer: `GitStarClub renders ${dimension.label} links from the category registry, using public flags, slugs, labels, and counts that were precomputed before the request.`,
    },
    {
      question: `Does the ${dimension.label} page run client-side filtering?`,
      answer: `No. The ${dimension.label} page is server-rendered from Blob JSON and does not add client-side filtering logic for the visible FAQ or category links.`,
    },
  ];
}

export function buildCategoryDetailFaqs({
  category,
  asOf,
  rows,
}: {
  category: CategoryRegistryEntry;
  asOf: string | null;
  rows: readonly CapsuleRankRow[];
}): FaqItem[] {
  const leader = rows[0];
  const second = rows[1];

  return [
    {
      question: `What repositories are included in ${category.label}?`,
      answer: asOf
        ? `As of ${asOf}, ${category.label} includes ${category.count.toLocaleString("en-US")} tracked repositories according to the category registry.`
        : `${category.label} includes ${category.count.toLocaleString("en-US")} tracked repositories according to the loaded category registry.`,
    },
    {
      question: `Which repository leads ${category.label}?`,
      answer: leader ? `${repoName(leader)} leads ${category.label} with ${rankValue(leader, "total")}.` : `The ${category.label} ranking is waiting for category rank rows.`,
    },
    {
      question: second ? `Which repository follows ${repoName(leader ?? second)} in ${category.label}?` : `Does ${category.label} show runner-up repositories?`,
      answer: second ? `${repoName(second)} follows in ${category.label} with ${rankValue(second, "total")}.` : "Runner-up repositories appear when category ranking rows are available.",
    },
    {
      question: `How is the ${category.label} ranking generated?`,
      answer: "GitStarClub combines category assignment JSON, all-time stock ranking data, and repository lookup fields. The page does not call live search or AI.",
    },
  ];
}

export function buildPulseFaqs({
  asOf,
  weekRows,
  monthRows,
  activeWeek,
  activeMonth,
}: {
  asOf: string | null;
  weekRows: readonly CapsuleRankRow[];
  monthRows: readonly CapsuleRankRow[];
  activeWeek: string;
  activeMonth: string;
}): FaqItem[] {
  const weekLead = weekRows[0];
  const monthLead = monthRows[0];

  return [
    {
      question: "What does GitStarClub Pulse show?",
      answer: asOf
        ? `As of ${asOf}, GitStarClub Pulse summarizes current open-source momentum across tracked repositories.`
        : "GitStarClub Pulse summarizes current open-source momentum from the loaded hot-snapshot and rank JSON.",
    },
    {
      question: `Which repository leads the latest available week ${activeWeek}?`,
      answer: weekLead
        ? `${repoName(weekLead)} leads ${activeWeek} with ${rankValue(weekLead, "gained")}.`
        : `The ${activeWeek} weekly mover list is waiting for rank rows.`,
    },
    {
      question: `Which repository leads the current month view ${activeMonth}?`,
      answer: monthLead
        ? `${repoName(monthLead)} leads ${activeMonth} with ${rankValue(monthLead, "gained")}.`
        : `The ${activeMonth} monthly mover list is waiting for hot-snapshot rows.`,
    },
    {
      question: "What data powers Pulse?",
      answer: "Pulse uses hot-snapshot JSON, weekly rank JSON, all-time rank JSON, and repository lookup JSON already loaded by the server route.",
    },
  ];
}

export function buildCompareFaqs(asOf: string | null): FaqItem[] {
  return [
    {
      question: "What does GitStarClub Compare do?",
      answer: asOf
        ? `As of ${asOf}, GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON.`
        : "GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON.",
    },
    {
      question: "Which repositories can be compared?",
      answer: "Compare accepts repositories already tracked by GitStarClub, using repository full names such as react/react and vuejs/vue.",
    },
    {
      question: "What comparison modes are available?",
      answer: "Readers can compare absolute calendar history or align repositories from their 10k-star milestone when that milestone is available.",
    },
    {
      question: "Does the compare FAQ describe URL query state?",
      answer: "No. The static compare page explains the deterministic comparison tool without claiming client-only query selections as server-rendered evidence.",
    },
  ];
}

export function visibleFaqPairs(items: readonly FaqItem[]): Array<[string, string]> {
  return items.map((item) => [item.question, item.answer]);
}

export function visibleFaqSnapshot(items: readonly FaqItem[]): string {
  return ["Frequently asked questions", ...items.flatMap((item) => [item.question, item.answer])].join("\n");
}

function repoMilestoneAnswer(repo: RepoEntity): string {
  const milestones = [
    ["10k", repo.milestones.crossed_10k],
    ["50k", repo.milestones.crossed_50k],
    ["100k", repo.milestones.crossed_100k],
  ] as const;
  const known = milestones.flatMap(([label, date]) => (date ? [`${label} in ${monthLabel(date)}`] : []));
  if (known.length === 0) {
    return `${repo.full_name} has no frozen 10k, 50k, or 100k milestone date in the loaded repository JSON.`;
  }
  return `${repo.full_name} crossed ${listLabels(known)} according to frozen milestone fields in the repository JSON.`;
}

function monthLabel(value: string): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return monthYearLabel("en", year, month);
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

function listLabels(values: readonly string[]): string {
  if (values.length === 0) return "none";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
