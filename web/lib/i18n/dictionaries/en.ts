// UI-chrome strings only. Data (repo names, languages, topics, numbers) is never translated
// (FRONTEND §7.1). `en` is the source-of-truth shape; ja/zh must match its keys.
export const en = {
  nav: { trending: "Trending", rankings: "Rankings", about: "About" },
  home: {
    lead: "Eleven years of momentum at a glance. Pick a year to drop into its chapter.",
    thisMonth: "This month so far",
  },
  year: {
    label: "Year",
    all: "all years",
    spine: "The spine",
    top: "Top movers of",
    gained: "stars gained across the tracked universe",
    ledBy: "led by",
  },
  month: {
    label: "Month",
    most: "Most stars",
    mostSub: "Biggest absolute gains",
    fastest: "Fastest rising",
    fastestSub: "Growth rate, ≥20k floor",
    newcomers: "Newcomers",
    newcomersSub: "First crossed 10k",
    daily: "Daily momentum",
    gained: "The tracked universe gained",
    newcomersWord: "newcomers",
  },
  week: { label: "Week", top: "Top movers this week" },
  repo: {
    history: "Star history",
    milestones: "Milestones",
    recent: "Recent months",
    created: "created",
    archived: "archived",
    github: "View on GitHub",
    rank: "rank",
  },
  org: {
    history: "Combined star history",
    repos: "Tracked repositories",
    total: "total",
    trackedRepos: "tracked repos",
    organization: "Organization",
    developer: "User",
  },
  rankings: {
    title: "All-time rankings",
    subtitle: "The largest repositories and organizations by current stars.",
    repositories: "Repositories",
    organizations: "Organizations",
    repos: "repos",
  },
  trending: {
    title: "Trending",
    subtitle: "What's surging across open source right now.",
    surging: "Surging this month",
    onThisDay: "On this day",
    crossed: "crossed",
  },
} as const;

export type Dict = typeof en;
export default en;
