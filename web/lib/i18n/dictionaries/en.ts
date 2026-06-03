// UI-chrome strings only. Data such as repo names, languages, topics, and numbers is never translated.
// `en` is the source-of-truth shape; every other dictionary must match these keys.
export const en = {
  nav: { home: "Home", trending: "Pulse", rankings: "Rankings", about: "About" },
  home: {
    heroPre: "A history of ",
    heroAccent: "open source",
    heroPost: ".",
    lead: "Eleven years of open-source activity in one view. Select a year to explore it.",
    thisMonth: "Month to date",
    perYear: "Stars added by year",
    gainedAria: "stars added",
  },
  about: {
    heroPre: "A factual ",
    heroAccent: "history",
    heroPost: ".",
    lead: "GitStarClub indexes public repositories with more than 10,000 stars and reconstructs how they gained stars over time, month by month and year by year, since 2015.",
    s1h: "Data sources",
    s1pPre: "Historical trends are reconstructed from ",
    s1pPost:
      " (public GitHub event data since 2015). Current totals come from the official GitHub GraphQL and Search APIs. We display only public data for public repositories.",
    s2h: "Methodological caveats",
    s2aStrong: "Two different measures.",
    s2aBody:
      " Historical trends use gross stars added based on GH Archive watch events. The current daily change is net, so it can decrease when stars are removed. This creates a small inconsistency at the boundary between the two measures. Current totals always use GitHub's authoritative star count.",
    s2bStrong: "Selection bias.",
    s2bBody:
      " We backfill only repositories that have at least 10,000 stars today. Projects that were once popular but later fell below that threshold are not included.",
    s2cStrong: "Why start in 2015?",
    s2cBody:
      " Before late 2012, GitHub watch events were not equivalent to stars. By 2015, the data is sufficiently consistent for long-term comparison.",
    s3h: "Time",
    s3p: "All data is stored in UTC and aggregated by UTC day. When an exact timestamp is shown, both UTC and JST (Japan Standard Time) are displayed.",
    back: "Back to the history",
  },
  year: {
    label: "Year",
    all: "All years",
    spine: "Overview",
    top: "Top repositories in",
    gained: "stars added across tracked repositories",
    ledBy: "led by",
  },
  month: {
    label: "Month",
    most: "Most stars added",
    mostSub: "Largest absolute increase",
    fastest: "Fastest growth",
    fastestSub: "Growth rate, minimum 20k stars",
    newcomers: "Newcomers",
    newcomersSub: "First exceeded 10k stars",
    daily: "Daily activity",
    gained: "Tracked repositories added",
    newcomersWord: "newcomers",
  },
  week: { label: "Week", top: "Top repositories this week" },
  repo: {
    about: "About",
    history: "Star trend",
    milestones: "Milestones",
    recent: "Recent activity",
    created: "created",
    archived: "archived",
    github: "Open on GitHub",
    rank: "rank",
    owner: "Owner",
    homepage: "Homepage",
    license: "License",
    latestRelease: "Latest release",
    noRelease: "No GitHub release found",
    topics: "Topics",
  },
  org: {
    history: "Combined star trend",
    repos: "Tracked repositories",
    total: "total",
    trackedRepos: "tracked repositories",
    organization: "Organization",
    developer: "Individual",
  },
  rankings: {
    title: "All-time rankings",
    subtitle: "Repositories and organizations ranked by current star count.",
    repositories: "Repositories",
    organizations: "Organizations",
    repos: "repositories",
  },
  trending: {
    title: "Open-source activity",
    subtitle: "What is changing this week, this month, and this year across tracked open-source repositories.",
    surging: "Rising this month",
    onThisDay: "On this day",
    crossed: "crossed",
  },
  footer: {
    madeIn: "Made in Tokyo",
    dataThrough: "Data updated through",
  },
  search: { label: "Search", placeholder: "Search repositories…", empty: "No matching repositories", loading: "Loading…" },
};

export type Dict = typeof en;
export default en;
