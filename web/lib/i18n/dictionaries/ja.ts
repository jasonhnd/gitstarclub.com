import type { Dict } from "./en";

// 日本語 UI chrome. データ（リポジトリ名・言語・トピック・数値）は翻訳しない。
const ja: Dict = {
  nav: { home: "ホーム", trending: "トレンド", rankings: "ランキング", about: "概要" },
  home: {
    heroPre: "",
    heroAccent: "オープンソース",
    heroPost: "の年代記。",
    lead: "11年分の勢いをひと目で。年を選んでその章へ。",
    thisMonth: "今月これまで",
    perYear: "年ごとの獲得スター",
    gainedAria: "獲得スター",
  },
  about: {
    heroPre: "誠実な",
    heroAccent: "記録",
    heroPost: "。",
    lead: "GitStarClub は1万スター超の公開リポジトリすべてを収録し、各プロジェクトがいつ伸びたかを2015年から月単位・年単位で再構成します。",
    s1h: "データの出どころ",
    s1pPre: "履歴は ",
    s1pPost:
      "（2015年以降の全公開 GitHub イベント）から再構成しています。現在の総数は公式の GitHub GraphQL・Search API から取得。公開リポジトリの公開データのみを表示します。",
    s2h: "正直な注意点",
    s2aStrong: "2つのものさし。",
    s2aBody:
      " 履歴カーブは追加された総（gross）スター数（GH Archive の watch イベント）を数えます。一方ライブの日次差分は純（net）で、スター取り消しにより減ることもあります。両者の継ぎ目はわずかに不整合で、star-history.com にも同じ制約があります。現在の総数は常に GitHub の権威ある値に合わせています。",
    s2bStrong: "生存者バイアス。",
    s2bBody: " 今日1万スター以上のリポジトリのみを遡って収録しています。かつて伸びて消えたプロジェクトは履歴にありません。",
    s2cStrong: "なぜ2015年から？",
    s2cBody:
      " 2012年末以前は GitHub の「watch」がスターと同義ではありませんでした。データは2015年に安定し、ここを現代オープンソースの起点としています。",
    s3h: "時刻",
    s3p: "すべて UTC で保存し、UTC の日付境界で集計します。正確な時刻を示す箇所では UTC と JST（日本時間）の両方を表示します — GitStarClub は東京で作られています。",
    back: "年代記に戻る",
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
  footer: {
    madeIn: "東京で制作",
    dataThrough: "データ更新日",
  },
};

export default ja;
