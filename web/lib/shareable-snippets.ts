import { fmtStars, monthLabel } from "@/lib/format";
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

export function absoluteSnippetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path === "/") return `${SITE}/`;
  return `${SITE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildWeeklyMoversSnippet({
  period,
  asOf,
  rows,
  path,
}: {
  period: string;
  asOf: string | null;
  rows: RepoRow[];
  path: string;
}): ShareableSnippetContent | null {
  const top = rows.slice(0, 3);
  if (!asOf || top.length === 0) return null;

  const leader = top[0];
  const followers = top.slice(1).map((row) => `${repoName(row)} (${signedStars(row.gained ?? 0)})`);
  const text = [
    `As of ${asOf}, ${repoName(leader)} led GitStarClub's ${period} weekly movers with ${signedStars(leader.gained ?? 0)} stars gained.`,
    followers.length ? `${followers.join(" and ")} followed in the tracked weekly ranking.` : "The tracked weekly ranking had no additional visible follower rows.",
    `Source: GitStarClub ${period} weekly rankings.`,
  ].join(" ");

  return snippet({
    kind: "weekly-movers",
    title: `${period} weekly movers`,
    text,
    links: [{ label: `${period} rankings`, href: path }, ...top.map((row) => ({ label: repoName(row), href: repoPath(row) }))],
  });
}

export function buildRepoMilestoneSnippet({
  repo,
  asOf,
  milestones,
}: {
  repo: { full_name: string };
  asOf: string | null;
  milestones: ExactRepoMilestone[];
}): ShareableSnippetContent | null {
  if (!asOf || milestones.length === 0) return null;

  const milestoneText = readableList(milestones.map((milestone) => `${milestone.label} in ${monthYearFromDate(milestone.date)}`));
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
  org,
  asOf,
  members,
}: {
  org: { login: string; current_stars_sum: number; repo_count: number };
  asOf: string | null;
  members: MemberRow[];
}): ShareableSnippetContent | null {
  if (!asOf) return null;

  const top = members.slice(0, 3);
  const leaders = top.length ? ` Top tracked repositories include ${readableList(top.map((row) => `${repoName(row)} (${fmtStars(row.total ?? 0)} stars)`))}.` : "";
  const text = `As of ${asOf}, ${org.login} has ${fmtStars(org.current_stars_sum)} total GitHub stars across ${org.repo_count.toLocaleString("en-US")} tracked repositories on GitStarClub.${leaders} Source: GitStarClub organization star history.`;

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
}: {
  kind: ShareableSnippetContent["kind"];
  title: string;
  text: string;
  links: SnippetLink[];
}): ShareableSnippetContent {
  const canonicalLinks = links.map((link) => ({ ...link, href: absoluteSnippetUrl(link.href) }));
  const copyText = [text, ...canonicalLinks.map((link) => `${link.label}: ${link.href}`)].join("\n");
  return {
    kind,
    title,
    text,
    links: canonicalLinks,
    copyText,
    embedHtml: embedHtml(title, text, canonicalLinks),
  };
}

function embedHtml(title: string, text: string, links: SnippetLink[]): string {
  const source = links[0];
  return [
    `<blockquote cite="${escapeAttribute(source?.href ?? absoluteSnippetUrl("/"))}">`,
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    `<p>${escapeHtml(text)}</p>`,
    source ? `<p><a href="${escapeAttribute(source.href)}">Source: ${escapeHtml(source.label)}</a></p>` : "",
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

function signedStars(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value))}`;
}

function monthYearFromDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${monthLabel("en", month, "long")} ${year}`;
}

function readableList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
