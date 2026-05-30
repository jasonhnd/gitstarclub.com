import type { Dict } from "./en";

// 日本語 UI chrome. データ（リポジトリ名・言語・トピック・数値）は翻訳しない。
const ja: Dict = {
  nav: { trending: "トレンド", rankings: "ランキング", about: "概要" },
  home: {
    lead: "11年分の勢いをひと目で。年を選んでその章へ。",
    thisMonth: "今月これまで",
  },
  year: {
    label: "年",
    all: "すべての年",
    spine: "背骨",
    top: "の急上昇リポジトリ",
    gained: "スターを獲得（対象全体）",
    ledBy: "首位は",
  },
  month: {
    label: "月",
    most: "最多スター",
    mostSub: "増加数の大きい順",
    fastest: "最速上昇",
    fastestSub: "増加率・2万スター以上",
    newcomers: "新規参入",
    newcomersSub: "初の1万スター突破",
    daily: "日次の勢い",
    gained: "対象全体の獲得スター",
    newcomersWord: "新規",
  },
  week: { label: "週", top: "今週の急上昇リポジトリ" },
  repo: {
    history: "スター履歴",
    milestones: "マイルストーン",
    recent: "直近の月別",
    created: "作成",
    archived: "アーカイブ済み",
    github: "GitHubで見る",
    rank: "順位",
  },
  org: {
    history: "合算スター履歴",
    repos: "対象リポジトリ",
    total: "合計",
    trackedRepos: "対象リポジトリ数",
    organization: "Organization",
    developer: "User",
  },
  rankings: {
    title: "歴代ランキング",
    subtitle: "現在のスター数による最大のリポジトリと組織。",
    repositories: "リポジトリ",
    organizations: "組織",
    repos: "リポジトリ",
  },
  trending: {
    title: "トレンド",
    subtitle: "いまオープンソースで急伸しているもの。",
    surging: "今月の急上昇",
    onThisDay: "今日という日に",
    crossed: "突破",
  },
};

export default ja;
