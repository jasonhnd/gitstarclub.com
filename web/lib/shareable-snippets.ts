import { fmtStars, formatInteger, monthYearLabel } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { ExactRepoMilestone } from "@/lib/repo-milestones";

export type SnippetLink = {
  label: string;
  href: string;
};

export type ShareableSnippetContent = {
  kind: "weekly-movers" | "repo-milestones" | "org-total";
  title: string;
  text: string;
  links: SnippetLink[];
  copyText: string;
  embedHtml: string;
};

type RepoRow = {
  owner: string;
  name: string;
  gained?: number;
  total?: number;
};

type MemberRow = {
  owner: string;
  name: string;
  total?: number;
};

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");

const WEEKLY_SNIPPET_COPY: Record<
  Locale,
  {
    title: string;
    leader: string;
    followers: string;
    noFollowers: string;
    source: string;
    rankingsLink: string;
    sourceLabel: string;
  }
> = {
  en: {
    title: "{period} weekly movers",
    leader: "As of {asOf}, {repo} led GitStarClub's {period} weekly movers with {value} stars gained.",
    followers: "{followers} followed in the tracked weekly ranking.",
    noFollowers: "The tracked weekly ranking had no additional visible follower rows.",
    source: "Source: GitStarClub {period} weekly rankings.",
    rankingsLink: "{period} rankings",
    sourceLabel: "Source",
  },
  ja: {
    title: "{period} 週次ランキング",
    leader: "{asOf} 時点で、{repo} が GitStarClub の {period} 週次上昇を {value} スター獲得でリードしました。",
    followers: "{followers} が追跡週次ランキングで続きました。",
    noFollowers: "追跡週次ランキングには追加の表示行がありませんでした。",
    source: "出典: GitStarClub {period} 週次ランキング。",
    rankingsLink: "{period} ランキング",
    sourceLabel: "出典",
  },
  zh: {
    title: "{period} 周度上涨",
    leader: "截至 {asOf}，{repo} 以新增 {value} 星领先 GitStarClub 的 {period} 周度上涨榜。",
    followers: "{followers} 在追踪周榜中随后。",
    noFollowers: "追踪周榜没有更多可见跟随行。",
    source: "来源：GitStarClub {period} 周度排名。",
    rankingsLink: "{period} 排名",
    sourceLabel: "来源",
  },
  "zh-TW": {
    title: "{period} 週度上升",
    leader: "截至 {asOf}，{repo} 以新增 {value} 星標領先 GitStarClub 的 {period} 週度上升榜。",
    followers: "{followers} 在追蹤週榜中隨後。",
    noFollowers: "追蹤週榜沒有更多可見跟隨列。",
    source: "來源：GitStarClub {period} 週度排名。",
    rankingsLink: "{period} 排名",
    sourceLabel: "來源",
  },
  ko: {
    title: "{period} 주간 상승",
    leader: "{asOf} 기준으로 {repo}가 {value} 스타 증가로 GitStarClub {period} 주간 상승을 이끌었습니다.",
    followers: "{followers}가 추적 주간 순위에서 뒤를 이었습니다.",
    noFollowers: "추적 주간 순위에는 추가 표시 행이 없습니다.",
    source: "출처: GitStarClub {period} 주간 순위.",
    rankingsLink: "{period} 순위",
    sourceLabel: "출처",
  },
  es: {
    title: "Movimientos semanales {period}",
    leader: "Al {asOf}, {repo} lideró los movimientos semanales {period} de GitStarClub con {value} estrellas ganadas.",
    followers: "{followers} siguieron en el ranking semanal monitoreado.",
    noFollowers: "El ranking semanal monitoreado no tuvo más filas visibles.",
    source: "Fuente: rankings semanales {period} de GitStarClub.",
    rankingsLink: "Rankings {period}",
    sourceLabel: "Fuente",
  },
  fr: {
    title: "Progressions hebdomadaires {period}",
    leader: "Au {asOf}, {repo} a mené les progressions hebdomadaires {period} de GitStarClub avec {value} étoiles gagnées.",
    followers: "{followers} ont suivi dans le classement hebdomadaire suivi.",
    noFollowers: "Le classement hebdomadaire suivi n'avait pas d'autres lignes visibles.",
    source: "Source : classements hebdomadaires {period} de GitStarClub.",
    rankingsLink: "Classements {period}",
    sourceLabel: "Source",
  },
};

export function absoluteSnippetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path === "/") return `${SITE}/`;
  return `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildWeeklyMoversSnippet({
  locale = "en",
  period,
  asOf,
  rows,
  path,
}: {
  locale?: Locale;
  period: string;
  asOf: string | null;
  rows: RepoRow[];
  path: string;
}): ShareableSnippetContent | null {
  const top = rows.slice(0, 3);
  if (!asOf || top.length === 0) return null;

  const copy = WEEKLY_SNIPPET_COPY[locale];
  const leader = top[0];
  const followers = top.slice(1).map((row) => `${repoName(row)} (${signedStars(row.gained ?? 0, locale)})`);
  const text = [
    fill(copy.leader, { asOf, repo: repoName(leader), period, value: signedStars(leader.gained ?? 0, locale) }),
    followers.length ? fill(copy.followers, { followers: joinItems(followers, locale) }) : copy.noFollowers,
    fill(copy.source, { period }),
  ].join(" ");

  return snippet({
    kind: "weekly-movers",
    title: fill(copy.title, { period }),
    text,
    links: [{ label: fill(copy.rankingsLink, { period }), href: path }, ...top.map((row) => ({ label: repoName(row), href: repoPath(row) }))],
    sourceLabel: copy.sourceLabel,
  });
}

export function buildRepoMilestoneSnippet({
  locale = "en",
  repo,
  asOf,
  milestones,
}: {
  locale?: Locale;
  repo: { full_name: string };
  asOf: string | null;
  milestones: ExactRepoMilestone[];
}): ShareableSnippetContent | null {
  if (!asOf || milestones.length === 0) return null;

  const milestoneText = readableList(
    milestones.map((milestone) => `${milestone.label} in ${monthYearFromDate(milestone.date, locale)}`),
    locale,
  );
  const text = `As of ${asOf}, GitStarClub records ${repo.full_name} crossing ${milestoneText}. These milestone dates come from frozen repository fields and link back to the matching monthly ranking pages. Source: GitStarClub repository star history.`;

  return snippet({
    kind: "repo-milestones",
    title: `${repo.full_name} milestones`,
    text,
    links: [
      { label: `${repo.full_name} star history`, href: `/${repo.full_name}` },
      ...milestones.map((milestone) => {
        const date = milestone.date.slice(0, 7);
        const [year, month] = date.split("-");
        return { label: `${milestone.label} ranking month`, href: `/rankings/${year}/${Number(month)}` };
      }),
    ],
  });
}

export function buildOrgTotalSnippet({
  locale = "en",
  org,
  asOf,
  members,
}: {
  locale?: Locale;
  org: { login: string; current_stars_sum: number; repo_count: number };
  asOf: string | null;
  members: MemberRow[];
}): ShareableSnippetContent | null {
  if (!asOf) return null;

  const top = members.slice(0, 3);
  const leaders = top.length ? ` Top tracked repositories include ${readableList(top.map((row) => `${repoName(row)} (${fmtStars(row.total ?? 0, locale)} stars)`), locale)}.` : "";
  const text = `As of ${asOf}, ${org.login} has ${fmtStars(org.current_stars_sum, locale)} total GitHub stars across ${formatInteger(locale, org.repo_count)} tracked repositories on GitStarClub.${leaders} Source: GitStarClub organization star history.`;

  return snippet({
    kind: "org-total",
    title: `${org.login} organization total`,
    text,
    links: [{ label: `${org.login} star history`, href: `/o/${org.login}` }, ...top.map((row) => ({ label: repoName(row), href: repoPath(row) }))],
  });
}

function snippet({
  kind,
  title,
  text,
  links,
  sourceLabel = "Source",
}: {
  kind: ShareableSnippetContent["kind"];
  title: string;
  text: string;
  links: SnippetLink[];
  sourceLabel?: string;
}): ShareableSnippetContent {
  const canonicalLinks = links.map((link) => ({ ...link, href: absoluteSnippetUrl(link.href) }));
  const copyText = [text, ...canonicalLinks.map((link) => `${link.label}: ${link.href}`)].join("\n");
  return {
    kind,
    title,
    text,
    links: canonicalLinks,
    copyText,
    embedHtml: embedHtml(title, text, canonicalLinks, sourceLabel),
  };
}

function embedHtml(title: string, text: string, links: SnippetLink[], sourceLabel = "Source"): string {
  const source = links[0];
  return [
    `<blockquote cite="${escapeAttribute(source?.href ?? absoluteSnippetUrl("/"))}">`,
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    `<p>${escapeHtml(text)}</p>`,
    source ? `<p><a href="${escapeAttribute(source.href)}">${escapeHtml(sourceLabel)}: ${escapeHtml(source.label)}</a></p>` : "",
    `</blockquote>`,
  ]
    .filter(Boolean)
    .join("");
}

function repoName(row: { owner: string; name: string }): string {
  return `${row.owner}/${row.name}`;
}

function repoPath(row: { owner: string; name: string }): string {
  return `/${repoName(row)}`;
}

function signedStars(value: number, locale: Locale): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value), locale)}`;
}

function monthYearFromDate(date: string, locale: Locale): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return monthYearLabel(locale, year, month);
}

function readableList(items: string[], locale: Locale = "en"): string {
  if (items.length <= 1) return items[0] ?? "";
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}

function joinItems(items: readonly string[], locale: Locale): string {
  if (items.length <= 1) return items[0] ?? "";
  const separator = locale === "ja" || locale === "zh" || locale === "zh-TW" ? "、" : locale === "es" ? " y " : locale === "fr" ? " et " : " and ";
  if (items.length === 2) return `${items[0]}${separator}${items[1]}`;
  const last = items.at(-1) ?? "";
  const head = items.slice(0, -1);
  if (locale === "ja" || locale === "zh" || locale === "zh-TW") return `${head.join("、")}、${last}`;
  return `${head.join(", ")}${separator}${last}`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
