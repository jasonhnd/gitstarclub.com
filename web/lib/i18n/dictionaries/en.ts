// UI-chrome strings only. Data (repo names, languages, topics, numbers) is never translated
// (FRONTEND §7.1). `en` is the source-of-truth shape; ja/zh must match its keys.
export const en = {
  nav: { home: "Home", trending: "Trending", rankings: "Rankings", about: "About" },
  home: {
    heroPre: "A chronicle of ",
    heroAccent: "open source",
    heroPost: ".",
    lead: "Eleven years of momentum at a glance. Pick a year to drop into its chapter.",
    thisMonth: "This month so far",
    perYear: "Stars gained per year",
    gainedAria: "stars gained",
  },
  about: {
    heroPre: "An honest ",
    heroAccent: "chronicle",
    heroPost: ".",
    lead: "GitStarClub indexes every public repo above 10,000 stars and reconstructs when each one rose — month by month, year by year, since 2015.",
    s1h: "Where the data comes from",
    s1pPre: "History is reconstructed from ",
    s1pPost:
      " (every public GitHub event since 2015). Current totals come from the official GitHub GraphQL & Search APIs. We only show public data about public repositories.",
    s2h: "The honest caveats",
    s2aStrong: "Two measuring sticks.",
    s2aBody:
      " The historical curve counts gross stars added (GH Archive watch events); the live daily delta is net (it can go down when stars are removed). The seam between them is slightly inconsistent — star-history.com has the same limitation. Current totals are always anchored to the authoritative GitHub count.",
    s2bStrong: "Survivor bias.",
    s2bBody:
      " We backfill only repos that are ≥10k stars today. Projects that rose and faded are missing from the history.",
    s2cStrong: "Why 2015?",
    s2cBody:
      " Before late 2012, GitHub’s “watch” wasn’t the same as a star; data stabilizes in 2015, our start of the modern open-source era.",
    s3h: "Time",
    s3p: "Everything is stored in UTC and aggregated on UTC day boundaries. Wherever an exact moment is shown, both UTC and JST (Japan time) appear — GitStarClub is made in Tokyo.",
    back: "Back to the chronicle",
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
  footer: {
    madeIn: "Made in Tokyo",
    dataThrough: "Data through",
  },
};

export type Dict = typeof en;
export default en;
