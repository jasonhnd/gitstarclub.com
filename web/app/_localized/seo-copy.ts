import type { Locale } from "@/lib/i18n";
import { fmtStars, formatInteger } from "@/lib/format";
import { ANSWER_CAPSULE_SOURCE, type AnswerCapsuleContent, type CapsuleOrgRankRow, type CapsuleRankRow } from "@/lib/geo-capsules";
import type { FaqItem } from "@/lib/jsonld";

type PulseFaqInput = {
  asOf: string | null;
  weekRows: readonly CapsuleRankRow[];
  monthRows: readonly CapsuleRankRow[];
  activeWeek: string;
  activeMonth: string;
};

type RankingsFaqInput = {
  asOf: string | null;
  repoRows: readonly CapsuleRankRow[];
  orgRows: readonly CapsuleOrgRankRow[];
};

type CoreSeoCopy = {
  sourceSuffix: string;
  pulseWeekFallback: string;
  pulseMonthFallback: string;
  pulseWeekLead: string;
  pulseMonthLead: string;
  pulseCapsule: string;
  pulseShowQ: string;
  pulseShowAWithAsOf: string;
  pulseShowANoAsOf: string;
  pulseWeekQ: string;
  pulseWeekA: string;
  pulseWeekFallbackA: string;
  pulseMonthQ: string;
  pulseMonthA: string;
  pulseMonthFallbackA: string;
  pulseDataQ: string;
  pulseDataA: string;
  rankingsRepoFallback: string;
  rankingsOrgFallback: string;
  rankingsRepoLead: string;
  rankingsOrgLead: string;
  rankingsCapsule: string;
  rankingsShowQ: string;
  rankingsShowAWithAsOf: string;
  rankingsShowANoAsOf: string;
  rankingsRepoQ: string;
  rankingsRepoA: string;
  rankingsRepoFallbackA: string;
  rankingsOrgQ: string;
  rankingsOrgA: string;
  rankingsOrgFallbackA: string;
  rankingsDataQ: string;
  rankingsDataA: string;
  compareCapsule: string;
  compareWhatQ: string;
  compareWhatAWithAsOf: string;
  compareWhatANoAsOf: string;
  compareReposQ: string;
  compareReposA: string;
  compareModesQ: string;
  compareModesA: string;
  compareQueryQ: string;
  compareQueryA: string;
};

const copy: Record<Locale, CoreSeoCopy> = {
  en: {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "weekly movers are waiting for rank rows",
    pulseMonthFallback: "monthly movers are waiting for hot-snapshot rows",
    pulseWeekLead: "{repo} leads {period} with {value} stars gained",
    pulseMonthLead: "{repo} leads {period} with {value} stars gained",
    pulseCapsule:
      "As of {asOf}, GitStarClub Pulse summarizes current open-source momentum across tracked repositories. {weekLead}; {monthLead}. The page is generated from hot-snapshot and rank JSON, not runtime search, a database, or AI.",
    pulseShowQ: "What does GitStarClub Pulse show?",
    pulseShowAWithAsOf: "As of {asOf}, GitStarClub Pulse summarizes current open-source momentum across tracked repositories.",
    pulseShowANoAsOf: "GitStarClub Pulse summarizes current open-source momentum from the loaded hot-snapshot and rank JSON.",
    pulseWeekQ: "Which repository leads the latest available week {period}?",
    pulseWeekA: "{repo} leads {period} with {value} stars gained.",
    pulseWeekFallbackA: "The {period} weekly mover list is waiting for rank rows.",
    pulseMonthQ: "Which repository leads the current month view {period}?",
    pulseMonthA: "{repo} leads {period} with {value} stars gained.",
    pulseMonthFallbackA: "The {period} monthly mover list is waiting for hot-snapshot rows.",
    pulseDataQ: "What data powers Pulse?",
    pulseDataA: "Pulse uses hot-snapshot JSON, weekly rank JSON, all-time rank JSON, and repository lookup JSON already loaded by the server route.",
    rankingsRepoFallback: "the repository list is waiting for rows",
    rankingsOrgFallback: "the organization list is waiting for rows",
    rankingsRepoLead: "{repo} leads repositories with {value} total stars",
    rankingsOrgLead: "{org} leads organizations with {value} total stars across {repos} tracked repositories",
    rankingsCapsule:
      "As of {asOf}, GitStarClub's all-time rankings summarize the largest tracked GitHub repositories and organizations. {repoLead}, while {orgLead}. The page is built from precomputed all-time rank JSON plus repository and organization lookup fields.",
    rankingsShowQ: "What do the all-time GitHub star rankings show?",
    rankingsShowAWithAsOf: "As of {asOf}, the all-time rankings list the largest tracked GitHub repositories and organizations by current total stars.",
    rankingsShowANoAsOf: "The all-time rankings list the largest tracked GitHub repositories and organizations by current total stars from precomputed ranking JSON.",
    rankingsRepoQ: "Which repository leads the all-time ranking?",
    rankingsRepoA: "{repo} leads the visible repository ranking with {value} total stars.",
    rankingsRepoFallbackA: "The visible repository ranking is waiting for precomputed rank rows.",
    rankingsOrgQ: "Which organization leads the all-time ranking?",
    rankingsOrgA: "{org} leads the visible organization ranking with {value} total stars across {repos} tracked repositories.",
    rankingsOrgFallbackA: "The visible organization ranking is waiting for precomputed organization rank rows.",
    rankingsDataQ: "What data powers the all-time ranking FAQ?",
    rankingsDataA: "GitStarClub builds this FAQ from all-time rank JSON, repository lookup JSON, and organization lookup JSON already loaded by the server route.",
    compareCapsule:
      "As of {asOf}, GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON. The static page explains absolute calendar history and 10k-aligned comparison without claiming client-only query-state facts as server-rendered evidence.",
    compareWhatQ: "What does GitStarClub Compare do?",
    compareWhatAWithAsOf: "As of {asOf}, GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON.",
    compareWhatANoAsOf: "GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON.",
    compareReposQ: "Which repositories can be compared?",
    compareReposA: "Compare accepts repositories already tracked by GitStarClub, using repository full names such as react/react and vuejs/vue.",
    compareModesQ: "What comparison modes are available?",
    compareModesA: "Readers can compare absolute calendar history or align repositories from their 10k-star milestone when that milestone is available.",
    compareQueryQ: "Does the compare FAQ describe URL query state?",
    compareQueryA: "No. The static compare page explains the deterministic comparison tool without claiming client-only query selections as server-rendered evidence.",
  },
  ja: {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "週次の上昇リポジトリはランキング行を待っています",
    pulseMonthFallback: "月次の上昇リポジトリは hot snapshot 行を待っています",
    pulseWeekLead: "{repo} が {period} を {value} スター獲得でリードしています",
    pulseMonthLead: "{repo} が {period} を {value} スター獲得でリードしています",
    pulseCapsule:
      "{asOf} 時点で、GitStarClub Pulse は追跡対象リポジトリの現在のオープンソース動向をまとめます。{weekLead}。{monthLead}。このページは hot snapshot とランキング JSON から生成され、実行時検索、データベース、AI は使いません。",
    pulseShowQ: "GitStarClub Pulse は何を表示しますか？",
    pulseShowAWithAsOf: "{asOf} 時点で、GitStarClub Pulse は追跡対象リポジトリの現在のオープンソース動向をまとめます。",
    pulseShowANoAsOf: "GitStarClub Pulse は読み込まれた hot snapshot とランキング JSON から現在のオープンソース動向をまとめます。",
    pulseWeekQ: "利用可能な最新週 {period} をリードするリポジトリは？",
    pulseWeekA: "{repo} が {period} を {value} スター獲得でリードしています。",
    pulseWeekFallbackA: "{period} の週次上昇リストはランキング行を待っています。",
    pulseMonthQ: "現在の月次ビュー {period} をリードするリポジトリは？",
    pulseMonthA: "{repo} が {period} を {value} スター獲得でリードしています。",
    pulseMonthFallbackA: "{period} の月次上昇リストは hot snapshot 行を待っています。",
    pulseDataQ: "Pulse のデータソースは何ですか？",
    pulseDataA: "Pulse はサーバールートで読み込まれた hot snapshot JSON、週次ランキング JSON、通算ランキング JSON、リポジトリ lookup JSON を使います。",
    rankingsRepoFallback: "リポジトリ一覧は行を待っています",
    rankingsOrgFallback: "組織一覧は行を待っています",
    rankingsRepoLead: "リポジトリでは {repo} が {value} 総スターでリードしています",
    rankingsOrgLead: "組織では {org} が {repos} 件の追跡リポジトリで {value} 総スターを持ちリードしています",
    rankingsCapsule:
      "{asOf} 時点で、GitStarClub の通算ランキングは最大規模の追跡 GitHub リポジトリと組織をまとめます。{repoLead}。一方、{orgLead}。このページは事前計算済み通算ランキング JSON とリポジトリ・組織 lookup から作られます。",
    rankingsShowQ: "通算 GitHub スターランキングは何を示しますか？",
    rankingsShowAWithAsOf: "{asOf} 時点で、通算ランキングは現在の総スター数にもとづき最大規模の追跡 GitHub リポジトリと組織を表示します。",
    rankingsShowANoAsOf: "通算ランキングは事前計算済みランキング JSON から、現在の総スター数にもとづく最大規模の追跡 GitHub リポジトリと組織を表示します。",
    rankingsRepoQ: "通算ランキングで首位のリポジトリは？",
    rankingsRepoA: "{repo} が可視リポジトリランキングを {value} 総スターでリードしています。",
    rankingsRepoFallbackA: "可視リポジトリランキングは事前計算済みランキング行を待っています。",
    rankingsOrgQ: "通算ランキングで首位の組織は？",
    rankingsOrgA: "{org} が {repos} 件の追跡リポジトリで {value} 総スターを持ち、可視組織ランキングをリードしています。",
    rankingsOrgFallbackA: "可視組織ランキングは事前計算済み組織ランキング行を待っています。",
    rankingsDataQ: "通算ランキング FAQ のデータソースは？",
    rankingsDataA: "GitStarClub はサーバールートで読み込まれた通算ランキング JSON、リポジトリ lookup JSON、組織 lookup JSON からこの FAQ を作ります。",
    compareCapsule:
      "{asOf} 時点で、GitStarClub Compare は事前計算済み repo-curve JSON から追跡リポジトリのスター履歴カーブを重ねられます。静的ページは絶対カレンダー履歴と 1 万到達基準の比較を説明し、クライアントだけのクエリ状態をサーバーレンダリングの根拠として扱いません。",
    compareWhatQ: "GitStarClub Compare は何をしますか？",
    compareWhatAWithAsOf: "{asOf} 時点で、GitStarClub Compare は事前計算済み repo-curve JSON から追跡リポジトリのスター履歴カーブを重ねられます。",
    compareWhatANoAsOf: "GitStarClub Compare は事前計算済み repo-curve JSON から追跡リポジトリのスター履歴カーブを重ねられます。",
    compareReposQ: "どのリポジトリを比較できますか？",
    compareReposA: "Compare は react/react や vuejs/vue のような full name を使い、GitStarClub に追跡済みのリポジトリを受け付けます。",
    compareModesQ: "利用できる比較モードは？",
    compareModesA: "読者は絶対カレンダー履歴、または利用可能な場合は 1 万スター到達から揃えた比較を選べます。",
    compareQueryQ: "compare FAQ は URL クエリ状態を説明しますか？",
    compareQueryA: "いいえ。静的 compare ページは決定的な比較ツールを説明し、クライアントだけの選択をサーバーレンダリング済みの根拠とは扱いません。",
  },
  zh: {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "周度上涨列表正在等待排名行",
    pulseMonthFallback: "月度上涨列表正在等待 hot snapshot 行",
    pulseWeekLead: "{repo} 以新增 {value} 星领先 {period}",
    pulseMonthLead: "{repo} 以新增 {value} 星领先 {period}",
    pulseCapsule:
      "截至 {asOf}，GitStarClub Pulse 汇总追踪仓库中的当前开源动量。{weekLead}；{monthLead}。该页面由 hot snapshot 和排名 JSON 生成，不依赖运行时搜索、数据库或 AI。",
    pulseShowQ: "GitStarClub Pulse 展示什么？",
    pulseShowAWithAsOf: "截至 {asOf}，GitStarClub Pulse 汇总追踪仓库中的当前开源动量。",
    pulseShowANoAsOf: "GitStarClub Pulse 从已加载的 hot snapshot 和排名 JSON 汇总当前开源动量。",
    pulseWeekQ: "最新可用周 {period} 由哪个仓库领先？",
    pulseWeekA: "{repo} 以新增 {value} 星领先 {period}。",
    pulseWeekFallbackA: "{period} 的周度上涨列表正在等待排名行。",
    pulseMonthQ: "当前月度视图 {period} 由哪个仓库领先？",
    pulseMonthA: "{repo} 以新增 {value} 星领先 {period}。",
    pulseMonthFallbackA: "{period} 的月度上涨列表正在等待 hot snapshot 行。",
    pulseDataQ: "Pulse 由哪些数据驱动？",
    pulseDataA: "Pulse 使用服务器路由已加载的 hot snapshot JSON、周度排名 JSON、历史总榜 JSON 和仓库 lookup JSON。",
    rankingsRepoFallback: "仓库列表正在等待行数据",
    rankingsOrgFallback: "组织列表正在等待行数据",
    rankingsRepoLead: "仓库中 {repo} 以 {value} 总星标领先",
    rankingsOrgLead: "组织中 {org} 在 {repos} 个追踪仓库中以 {value} 总星标领先",
    rankingsCapsule:
      "截至 {asOf}，GitStarClub 历史总榜汇总最大的已追踪 GitHub 仓库与组织。{repoLead}；同时，{orgLead}。该页面由预计算历史总榜 JSON 以及仓库和组织 lookup 字段生成。",
    rankingsShowQ: "GitHub 历史总星标排行榜展示什么？",
    rankingsShowAWithAsOf: "截至 {asOf}，历史总榜按当前总星标列出最大的已追踪 GitHub 仓库与组织。",
    rankingsShowANoAsOf: "历史总榜从预计算排名 JSON 中按当前总星标列出最大的已追踪 GitHub 仓库与组织。",
    rankingsRepoQ: "哪个仓库领先历史总榜？",
    rankingsRepoA: "{repo} 以 {value} 总星标领先可见仓库榜。",
    rankingsRepoFallbackA: "可见仓库榜正在等待预计算排名行。",
    rankingsOrgQ: "哪个组织领先历史总榜？",
    rankingsOrgA: "{org} 在 {repos} 个追踪仓库中以 {value} 总星标领先可见组织榜。",
    rankingsOrgFallbackA: "可见组织榜正在等待预计算组织排名行。",
    rankingsDataQ: "历史总榜 FAQ 由哪些数据驱动？",
    rankingsDataA: "GitStarClub 从服务器路由已加载的历史总榜 JSON、仓库 lookup JSON 和组织 lookup JSON 构建此 FAQ。",
    compareCapsule:
      "截至 {asOf}，GitStarClub Compare 可从预计算 repo-curve JSON 叠加追踪仓库的星标历史曲线。静态页面说明绝对日历历史和 1 万星对齐比较，不把仅客户端的查询状态当作服务器渲染证据。",
    compareWhatQ: "GitStarClub Compare 做什么？",
    compareWhatAWithAsOf: "截至 {asOf}，GitStarClub Compare 可从预计算 repo-curve JSON 叠加追踪仓库的星标历史曲线。",
    compareWhatANoAsOf: "GitStarClub Compare 可从预计算 repo-curve JSON 叠加追踪仓库的星标历史曲线。",
    compareReposQ: "哪些仓库可以对比？",
    compareReposA: "Compare 接受 GitStarClub 已追踪的仓库，使用 react/react 和 vuejs/vue 这样的仓库 full name。",
    compareModesQ: "有哪些对比模式？",
    compareModesA: "读者可以比较绝对日历历史，也可以在里程碑可用时从 1 万星节点对齐比较。",
    compareQueryQ: "compare FAQ 会描述 URL 查询状态吗？",
    compareQueryA: "不会。静态 compare 页面解释确定性的比较工具，不把仅客户端选择当作服务器渲染证据。",
  },
  "zh-TW": {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "週度上升列表正在等待排名列",
    pulseMonthFallback: "月度上升列表正在等待 hot snapshot 列",
    pulseWeekLead: "{repo} 以新增 {value} 星領先 {period}",
    pulseMonthLead: "{repo} 以新增 {value} 星領先 {period}",
    pulseCapsule:
      "截至 {asOf}，GitStarClub Pulse 彙總追蹤倉庫中的目前開源動量。{weekLead}；{monthLead}。該頁面由 hot snapshot 和排名 JSON 產生，不依賴執行時搜尋、資料庫或 AI。",
    pulseShowQ: "GitStarClub Pulse 展示什麼？",
    pulseShowAWithAsOf: "截至 {asOf}，GitStarClub Pulse 彙總追蹤倉庫中的目前開源動量。",
    pulseShowANoAsOf: "GitStarClub Pulse 從已載入的 hot snapshot 和排名 JSON 彙總目前開源動量。",
    pulseWeekQ: "最新可用週 {period} 由哪個倉庫領先？",
    pulseWeekA: "{repo} 以新增 {value} 星領先 {period}。",
    pulseWeekFallbackA: "{period} 的週度上升列表正在等待排名列。",
    pulseMonthQ: "目前月度視圖 {period} 由哪個倉庫領先？",
    pulseMonthA: "{repo} 以新增 {value} 星領先 {period}。",
    pulseMonthFallbackA: "{period} 的月度上升列表正在等待 hot snapshot 列。",
    pulseDataQ: "Pulse 由哪些資料驅動？",
    pulseDataA: "Pulse 使用伺服器路由已載入的 hot snapshot JSON、週度排名 JSON、歷史總榜 JSON 和倉庫 lookup JSON。",
    rankingsRepoFallback: "倉庫列表正在等待列資料",
    rankingsOrgFallback: "組織列表正在等待列資料",
    rankingsRepoLead: "倉庫中 {repo} 以 {value} 總星標領先",
    rankingsOrgLead: "組織中 {org} 在 {repos} 個追蹤倉庫中以 {value} 總星標領先",
    rankingsCapsule:
      "截至 {asOf}，GitStarClub 歷史總榜彙總最大的已追蹤 GitHub 倉庫與組織。{repoLead}；同時，{orgLead}。該頁面由預先計算歷史總榜 JSON 以及倉庫和組織 lookup 欄位產生。",
    rankingsShowQ: "GitHub 歷史總星標排行榜展示什麼？",
    rankingsShowAWithAsOf: "截至 {asOf}，歷史總榜依目前總星標列出最大的已追蹤 GitHub 倉庫與組織。",
    rankingsShowANoAsOf: "歷史總榜從預先計算排名 JSON 中依目前總星標列出最大的已追蹤 GitHub 倉庫與組織。",
    rankingsRepoQ: "哪個倉庫領先歷史總榜？",
    rankingsRepoA: "{repo} 以 {value} 總星標領先可見倉庫榜。",
    rankingsRepoFallbackA: "可見倉庫榜正在等待預先計算排名列。",
    rankingsOrgQ: "哪個組織領先歷史總榜？",
    rankingsOrgA: "{org} 在 {repos} 個追蹤倉庫中以 {value} 總星標領先可見組織榜。",
    rankingsOrgFallbackA: "可見組織榜正在等待預先計算組織排名列。",
    rankingsDataQ: "歷史總榜 FAQ 由哪些資料驅動？",
    rankingsDataA: "GitStarClub 從伺服器路由已載入的歷史總榜 JSON、倉庫 lookup JSON 和組織 lookup JSON 建立此 FAQ。",
    compareCapsule:
      "截至 {asOf}，GitStarClub Compare 可從預先計算 repo-curve JSON 疊加追蹤倉庫的星標歷史曲線。靜態頁面說明絕對日曆歷史和 1 萬星對齊比較，不把僅客戶端的查詢狀態當作伺服器渲染證據。",
    compareWhatQ: "GitStarClub Compare 做什麼？",
    compareWhatAWithAsOf: "截至 {asOf}，GitStarClub Compare 可從預先計算 repo-curve JSON 疊加追蹤倉庫的星標歷史曲線。",
    compareWhatANoAsOf: "GitStarClub Compare 可從預先計算 repo-curve JSON 疊加追蹤倉庫的星標歷史曲線。",
    compareReposQ: "哪些倉庫可以對比？",
    compareReposA: "Compare 接受 GitStarClub 已追蹤的倉庫，使用 react/react 和 vuejs/vue 這樣的倉庫 full name。",
    compareModesQ: "有哪些對比模式？",
    compareModesA: "讀者可以比較絕對日曆歷史，也可以在里程碑可用時從 1 萬星節點對齊比較。",
    compareQueryQ: "compare FAQ 會描述 URL 查詢狀態嗎？",
    compareQueryA: "不會。靜態 compare 頁面解釋決定性的比較工具，不把僅客戶端選擇當作伺服器渲染證據。",
  },
  ko: {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "주간 상승 목록은 순위 행을 기다리고 있습니다",
    pulseMonthFallback: "월간 상승 목록은 hot snapshot 행을 기다리고 있습니다",
    pulseWeekLead: "{repo}가 {period}에서 {value} 스타 증가로 앞서고 있습니다",
    pulseMonthLead: "{repo}가 {period}에서 {value} 스타 증가로 앞서고 있습니다",
    pulseCapsule:
      "{asOf} 기준으로 GitStarClub Pulse는 추적 저장소의 현재 오픈소스 움직임을 요약합니다. {weekLead}; {monthLead}. 이 페이지는 hot snapshot과 순위 JSON에서 생성되며 런타임 검색, 데이터베이스, AI를 사용하지 않습니다.",
    pulseShowQ: "GitStarClub Pulse는 무엇을 보여주나요?",
    pulseShowAWithAsOf: "{asOf} 기준으로 GitStarClub Pulse는 추적 저장소의 현재 오픈소스 움직임을 요약합니다.",
    pulseShowANoAsOf: "GitStarClub Pulse는 로드된 hot snapshot과 순위 JSON에서 현재 오픈소스 움직임을 요약합니다.",
    pulseWeekQ: "사용 가능한 최신 주 {period}를 이끄는 저장소는 무엇인가요?",
    pulseWeekA: "{repo}가 {period}에서 {value} 스타 증가로 앞서고 있습니다.",
    pulseWeekFallbackA: "{period} 주간 상승 목록은 순위 행을 기다리고 있습니다.",
    pulseMonthQ: "현재 월간 보기 {period}를 이끄는 저장소는 무엇인가요?",
    pulseMonthA: "{repo}가 {period}에서 {value} 스타 증가로 앞서고 있습니다.",
    pulseMonthFallbackA: "{period} 월간 상승 목록은 hot snapshot 행을 기다리고 있습니다.",
    pulseDataQ: "Pulse는 어떤 데이터로 만들어지나요?",
    pulseDataA: "Pulse는 서버 route가 이미 로드한 hot snapshot JSON, 주간 순위 JSON, 역대 순위 JSON, 저장소 lookup JSON을 사용합니다.",
    rankingsRepoFallback: "저장소 목록은 행을 기다리고 있습니다",
    rankingsOrgFallback: "조직 목록은 행을 기다리고 있습니다",
    rankingsRepoLead: "저장소에서는 {repo}가 {value} 총 스타로 앞서고 있습니다",
    rankingsOrgLead: "조직에서는 {org}가 {repos}개 추적 저장소에서 {value} 총 스타로 앞서고 있습니다",
    rankingsCapsule:
      "{asOf} 기준으로 GitStarClub의 역대 순위는 가장 큰 추적 GitHub 저장소와 조직을 요약합니다. {repoLead}; 한편 {orgLead}. 이 페이지는 사전 계산된 역대 순위 JSON과 저장소 및 조직 lookup 필드로 만들어집니다.",
    rankingsShowQ: "역대 GitHub 스타 순위는 무엇을 보여주나요?",
    rankingsShowAWithAsOf: "{asOf} 기준으로 역대 순위는 현재 총 스타 수 기준 가장 큰 추적 GitHub 저장소와 조직을 보여줍니다.",
    rankingsShowANoAsOf: "역대 순위는 사전 계산된 순위 JSON에서 현재 총 스타 수 기준 가장 큰 추적 GitHub 저장소와 조직을 보여줍니다.",
    rankingsRepoQ: "역대 순위를 이끄는 저장소는 무엇인가요?",
    rankingsRepoA: "{repo}가 {value} 총 스타로 표시된 저장소 순위를 이끌고 있습니다.",
    rankingsRepoFallbackA: "표시된 저장소 순위는 사전 계산된 순위 행을 기다리고 있습니다.",
    rankingsOrgQ: "역대 순위를 이끄는 조직은 무엇인가요?",
    rankingsOrgA: "{org}가 {repos}개 추적 저장소에서 {value} 총 스타로 표시된 조직 순위를 이끌고 있습니다.",
    rankingsOrgFallbackA: "표시된 조직 순위는 사전 계산된 조직 순위 행을 기다리고 있습니다.",
    rankingsDataQ: "역대 순위 FAQ는 어떤 데이터로 만들어지나요?",
    rankingsDataA: "GitStarClub은 서버 route가 이미 로드한 역대 순위 JSON, 저장소 lookup JSON, 조직 lookup JSON으로 이 FAQ를 만듭니다.",
    compareCapsule:
      "{asOf} 기준으로 GitStarClub Compare는 사전 계산된 repo-curve JSON에서 추적 저장소의 스타 히스토리 곡선을 겹쳐 보여줍니다. 정적 페이지는 절대 달력 히스토리와 1만 스타 정렬 비교를 설명하며, 클라이언트 전용 쿼리 상태를 서버 렌더링 근거로 주장하지 않습니다.",
    compareWhatQ: "GitStarClub Compare는 무엇을 하나요?",
    compareWhatAWithAsOf: "{asOf} 기준으로 GitStarClub Compare는 사전 계산된 repo-curve JSON에서 추적 저장소의 스타 히스토리 곡선을 겹쳐 보여줍니다.",
    compareWhatANoAsOf: "GitStarClub Compare는 사전 계산된 repo-curve JSON에서 추적 저장소의 스타 히스토리 곡선을 겹쳐 보여줍니다.",
    compareReposQ: "어떤 저장소를 비교할 수 있나요?",
    compareReposA: "Compare는 react/react, vuejs/vue 같은 저장소 full name을 사용해 GitStarClub이 이미 추적하는 저장소를 받습니다.",
    compareModesQ: "어떤 비교 모드가 있나요?",
    compareModesA: "독자는 절대 달력 히스토리를 비교하거나, 마일스톤이 있을 때 1만 스타 도달 시점부터 정렬할 수 있습니다.",
    compareQueryQ: "compare FAQ는 URL 쿼리 상태를 설명하나요?",
    compareQueryA: "아니요. 정적 compare 페이지는 결정적인 비교 도구를 설명하며 클라이언트 전용 선택을 서버 렌더링 증거로 주장하지 않습니다.",
  },
  es: {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "la lista semanal espera filas de ranking",
    pulseMonthFallback: "la lista mensual espera filas del hot snapshot",
    pulseWeekLead: "{repo} lidera {period} con {value} estrellas ganadas",
    pulseMonthLead: "{repo} lidera {period} con {value} estrellas ganadas",
    pulseCapsule:
      "Al {asOf}, GitStarClub Pulse resume el impulso actual del código abierto en repositorios monitoreados. {weekLead}; {monthLead}. La página se genera desde hot-snapshot y JSON de ranking, no desde búsqueda, base de datos ni IA en tiempo de ejecución.",
    pulseShowQ: "¿Qué muestra GitStarClub Pulse?",
    pulseShowAWithAsOf: "Al {asOf}, GitStarClub Pulse resume el impulso actual del código abierto en repositorios monitoreados.",
    pulseShowANoAsOf: "GitStarClub Pulse resume el impulso actual del código abierto desde el hot-snapshot y JSON de ranking cargados.",
    pulseWeekQ: "¿Qué repositorio lidera la última semana disponible {period}?",
    pulseWeekA: "{repo} lidera {period} con {value} estrellas ganadas.",
    pulseWeekFallbackA: "La lista semanal de {period} espera filas de ranking.",
    pulseMonthQ: "¿Qué repositorio lidera la vista mensual actual {period}?",
    pulseMonthA: "{repo} lidera {period} con {value} estrellas ganadas.",
    pulseMonthFallbackA: "La lista mensual de {period} espera filas del hot snapshot.",
    pulseDataQ: "¿Qué datos alimentan Pulse?",
    pulseDataA: "Pulse usa hot-snapshot JSON, ranking semanal JSON, ranking histórico JSON y lookup JSON de repositorios ya cargados por la ruta del servidor.",
    rankingsRepoFallback: "la lista de repositorios espera filas",
    rankingsOrgFallback: "la lista de organizaciones espera filas",
    rankingsRepoLead: "{repo} lidera los repositorios con {value} estrellas totales",
    rankingsOrgLead: "{org} lidera las organizaciones con {value} estrellas totales en {repos} repositorios monitoreados",
    rankingsCapsule:
      "Al {asOf}, los rankings históricos de GitStarClub resumen los mayores repositorios y organizaciones de GitHub monitoreados. {repoLead}, mientras {orgLead}. La página se construye desde ranking histórico JSON precalculado y campos lookup de repositorios y organizaciones.",
    rankingsShowQ: "¿Qué muestran los rankings históricos de estrellas de GitHub?",
    rankingsShowAWithAsOf: "Al {asOf}, los rankings históricos listan los mayores repositorios y organizaciones de GitHub monitoreados por estrellas totales actuales.",
    rankingsShowANoAsOf: "Los rankings históricos listan los mayores repositorios y organizaciones de GitHub monitoreados por estrellas totales actuales desde JSON de ranking precalculado.",
    rankingsRepoQ: "¿Qué repositorio lidera el ranking histórico?",
    rankingsRepoA: "{repo} lidera el ranking visible de repositorios con {value} estrellas totales.",
    rankingsRepoFallbackA: "El ranking visible de repositorios espera filas de ranking precalculadas.",
    rankingsOrgQ: "¿Qué organización lidera el ranking histórico?",
    rankingsOrgA: "{org} lidera el ranking visible de organizaciones con {value} estrellas totales en {repos} repositorios monitoreados.",
    rankingsOrgFallbackA: "El ranking visible de organizaciones espera filas de ranking precalculadas.",
    rankingsDataQ: "¿Qué datos alimentan la FAQ del ranking histórico?",
    rankingsDataA: "GitStarClub construye esta FAQ desde ranking histórico JSON, lookup JSON de repositorios y lookup JSON de organizaciones ya cargados por la ruta del servidor.",
    compareCapsule:
      "Al {asOf}, GitStarClub Compare permite superponer curvas de historial de estrellas desde repo-curve JSON precalculado. La página estática explica historial calendario absoluto y comparación alineada a 10k sin presentar estado de consulta solo del cliente como evidencia renderizada en servidor.",
    compareWhatQ: "¿Qué hace GitStarClub Compare?",
    compareWhatAWithAsOf: "Al {asOf}, GitStarClub Compare permite superponer curvas de historial de estrellas desde repo-curve JSON precalculado.",
    compareWhatANoAsOf: "GitStarClub Compare permite superponer curvas de historial de estrellas desde repo-curve JSON precalculado.",
    compareReposQ: "¿Qué repositorios se pueden comparar?",
    compareReposA: "Compare acepta repositorios ya monitoreados por GitStarClub, usando nombres completos como react/react y vuejs/vue.",
    compareModesQ: "¿Qué modos de comparación hay?",
    compareModesA: "Los lectores pueden comparar historial calendario absoluto o alinear repositorios desde su hito de 10k estrellas cuando está disponible.",
    compareQueryQ: "¿La FAQ de compare describe el estado de query de la URL?",
    compareQueryA: "No. La página estática de compare explica la herramienta determinista sin presentar selecciones solo del cliente como evidencia renderizada en servidor.",
  },
  fr: {
    sourceSuffix: " - GitStarClub",
    pulseWeekFallback: "la liste hebdomadaire attend les lignes de classement",
    pulseMonthFallback: "la liste mensuelle attend les lignes du hot snapshot",
    pulseWeekLead: "{repo} mène {period} avec {value} étoiles gagnées",
    pulseMonthLead: "{repo} mène {period} avec {value} étoiles gagnées",
    pulseCapsule:
      "Au {asOf}, GitStarClub Pulse résume la dynamique open source actuelle parmi les dépôts suivis. {weekLead}; {monthLead}. La page est générée depuis le hot-snapshot et les JSON de classement, sans recherche, base de données ni IA à l'exécution.",
    pulseShowQ: "Que montre GitStarClub Pulse ?",
    pulseShowAWithAsOf: "Au {asOf}, GitStarClub Pulse résume la dynamique open source actuelle parmi les dépôts suivis.",
    pulseShowANoAsOf: "GitStarClub Pulse résume la dynamique open source actuelle depuis le hot-snapshot et les JSON de classement chargés.",
    pulseWeekQ: "Quel dépôt mène la dernière semaine disponible {period} ?",
    pulseWeekA: "{repo} mène {period} avec {value} étoiles gagnées.",
    pulseWeekFallbackA: "La liste hebdomadaire {period} attend les lignes de classement.",
    pulseMonthQ: "Quel dépôt mène la vue mensuelle actuelle {period} ?",
    pulseMonthA: "{repo} mène {period} avec {value} étoiles gagnées.",
    pulseMonthFallbackA: "La liste mensuelle {period} attend les lignes du hot snapshot.",
    pulseDataQ: "Quelles données alimentent Pulse ?",
    pulseDataA: "Pulse utilise le hot-snapshot JSON, le classement hebdomadaire JSON, le classement historique JSON et le lookup JSON des dépôts déjà chargés par la route serveur.",
    rankingsRepoFallback: "la liste des dépôts attend des lignes",
    rankingsOrgFallback: "la liste des organisations attend des lignes",
    rankingsRepoLead: "{repo} mène les dépôts avec {value} étoiles totales",
    rankingsOrgLead: "{org} mène les organisations avec {value} étoiles totales sur {repos} dépôts suivis",
    rankingsCapsule:
      "Au {asOf}, les classements historiques de GitStarClub résument les plus grands dépôts et organisations GitHub suivis. {repoLead}, tandis que {orgLead}. La page est construite depuis le JSON de classement historique précalculé et les champs lookup de dépôts et d'organisations.",
    rankingsShowQ: "Que montrent les classements historiques d'étoiles GitHub ?",
    rankingsShowAWithAsOf: "Au {asOf}, les classements historiques listent les plus grands dépôts et organisations GitHub suivis par étoiles totales actuelles.",
    rankingsShowANoAsOf: "Les classements historiques listent les plus grands dépôts et organisations GitHub suivis par étoiles totales actuelles depuis un JSON de classement précalculé.",
    rankingsRepoQ: "Quel dépôt mène le classement historique ?",
    rankingsRepoA: "{repo} mène le classement visible des dépôts avec {value} étoiles totales.",
    rankingsRepoFallbackA: "Le classement visible des dépôts attend des lignes de classement précalculées.",
    rankingsOrgQ: "Quelle organisation mène le classement historique ?",
    rankingsOrgA: "{org} mène le classement visible des organisations avec {value} étoiles totales sur {repos} dépôts suivis.",
    rankingsOrgFallbackA: "Le classement visible des organisations attend des lignes de classement précalculées.",
    rankingsDataQ: "Quelles données alimentent la FAQ du classement historique ?",
    rankingsDataA: "GitStarClub construit cette FAQ depuis le classement historique JSON, le lookup JSON des dépôts et le lookup JSON des organisations déjà chargés par la route serveur.",
    compareCapsule:
      "Au {asOf}, GitStarClub Compare permet de superposer les courbes d'historique des étoiles depuis un repo-curve JSON précalculé. La page statique explique l'historique calendaire absolu et la comparaison alignée sur 10k sans présenter l'état de requête côté client comme preuve rendue côté serveur.",
    compareWhatQ: "Que fait GitStarClub Compare ?",
    compareWhatAWithAsOf: "Au {asOf}, GitStarClub Compare permet de superposer les courbes d'historique des étoiles depuis un repo-curve JSON précalculé.",
    compareWhatANoAsOf: "GitStarClub Compare permet de superposer les courbes d'historique des étoiles depuis un repo-curve JSON précalculé.",
    compareReposQ: "Quels dépôts peuvent être comparés ?",
    compareReposA: "Compare accepte les dépôts déjà suivis par GitStarClub, avec des noms complets comme react/react et vuejs/vue.",
    compareModesQ: "Quels modes de comparaison sont disponibles ?",
    compareModesA: "Les lecteurs peuvent comparer l'historique calendaire absolu ou aligner les dépôts depuis leur jalon de 10k étoiles lorsqu'il est disponible.",
    compareQueryQ: "La FAQ compare décrit-elle l'état de query de l'URL ?",
    compareQueryA: "Non. La page statique compare explique l'outil déterministe sans présenter les sélections côté client comme preuve rendue côté serveur.",
  },
};

export function buildLocalizedPulseCapsule({
  locale,
  asOf,
  weekRows,
  monthRows,
  activeWeek,
  activeMonth,
}: {
  locale: Locale;
  asOf: string;
  weekRows: readonly CapsuleRankRow[];
  monthRows: readonly CapsuleRankRow[];
  activeWeek: string;
  activeMonth: string;
}): AnswerCapsuleContent {
  const c = copy[locale];
  const weekLead = weekRows[0] ? fill(c.pulseWeekLead, rankValues(weekRows[0], { period: activeWeek, metric: "gained" })) : c.pulseWeekFallback;
  const monthLead = monthRows[0] ? fill(c.pulseMonthLead, rankValues(monthRows[0], { period: activeMonth, metric: "gained" })) : c.pulseMonthFallback;
  return capsule(locale, fill(c.pulseCapsule, { asOf, weekLead, monthLead }), asOf);
}

export function buildLocalizedPulseFaqs(locale: Locale, input: PulseFaqInput): FaqItem[] {
  const c = copy[locale];
  const weekLead = input.weekRows[0];
  const monthLead = input.monthRows[0];
  return [
    {
      question: c.pulseShowQ,
      answer: input.asOf ? fill(c.pulseShowAWithAsOf, { asOf: input.asOf }) : c.pulseShowANoAsOf,
    },
    {
      question: fill(c.pulseWeekQ, { period: input.activeWeek }),
      answer: weekLead
        ? fill(c.pulseWeekA, rankValues(weekLead, { period: input.activeWeek, metric: "gained" }))
        : fill(c.pulseWeekFallbackA, { period: input.activeWeek }),
    },
    {
      question: fill(c.pulseMonthQ, { period: input.activeMonth }),
      answer: monthLead
        ? fill(c.pulseMonthA, rankValues(monthLead, { period: input.activeMonth, metric: "gained" }))
        : fill(c.pulseMonthFallbackA, { period: input.activeMonth }),
    },
    { question: c.pulseDataQ, answer: c.pulseDataA },
  ];
}

export function buildLocalizedAllTimeRankingCapsule({
  locale,
  asOf,
  repoRows,
  orgRows,
}: {
  locale: Locale;
  asOf: string;
  repoRows: readonly CapsuleRankRow[];
  orgRows: readonly CapsuleOrgRankRow[];
}): AnswerCapsuleContent {
  const c = copy[locale];
  const repoLead = repoRows[0] ? fill(c.rankingsRepoLead, rankValues(repoRows[0], { metric: "total" })) : c.rankingsRepoFallback;
  const orgLead = orgRows[0] ? fill(c.rankingsOrgLead, orgValues(orgRows[0], locale)) : c.rankingsOrgFallback;
  return capsule(locale, fill(c.rankingsCapsule, { asOf, repoLead, orgLead }), asOf);
}

export function buildLocalizedAllTimeRankingFaqs(locale: Locale, input: RankingsFaqInput): FaqItem[] {
  const c = copy[locale];
  const repoLead = input.repoRows[0];
  const orgLead = input.orgRows[0];
  return [
    {
      question: c.rankingsShowQ,
      answer: input.asOf ? fill(c.rankingsShowAWithAsOf, { asOf: input.asOf }) : c.rankingsShowANoAsOf,
    },
    {
      question: c.rankingsRepoQ,
      answer: repoLead ? fill(c.rankingsRepoA, rankValues(repoLead, { metric: "total" })) : c.rankingsRepoFallbackA,
    },
    {
      question: c.rankingsOrgQ,
      answer: orgLead ? fill(c.rankingsOrgA, orgValues(orgLead, locale)) : c.rankingsOrgFallbackA,
    },
    { question: c.rankingsDataQ, answer: c.rankingsDataA },
  ];
}

export function buildLocalizedCompareCapsule(locale: Locale, asOf: string): AnswerCapsuleContent {
  return capsule(locale, fill(copy[locale].compareCapsule, { asOf }), asOf);
}

export function buildLocalizedCompareFaqs(locale: Locale, asOf: string | null): FaqItem[] {
  const c = copy[locale];
  return [
    {
      question: c.compareWhatQ,
      answer: asOf ? fill(c.compareWhatAWithAsOf, { asOf }) : c.compareWhatANoAsOf,
    },
    { question: c.compareReposQ, answer: c.compareReposA },
    { question: c.compareModesQ, answer: c.compareModesA },
    { question: c.compareQueryQ, answer: c.compareQueryA },
  ];
}

function capsule(locale: Locale, text: string, asOf: string): AnswerCapsuleContent {
  return { text: `${text}${copy[locale].sourceSuffix}`, asOf, source: ANSWER_CAPSULE_SOURCE };
}

function rankValues(row: CapsuleRankRow, opts: { period?: string; metric: "gained" | "total" }): Record<string, string> {
  return {
    repo: `${row.owner}/${row.name}`,
    period: opts.period ?? "",
    value: opts.metric === "total" ? fmtStars(row.total ?? 0) : signedStars(row.gained ?? 0),
  };
}

function orgValues(row: CapsuleOrgRankRow, locale: Locale): Record<string, string> {
  return {
    org: row.login,
    value: fmtStars(row.current_stars_sum),
    repos: formatInteger(locale, row.repo_count),
  };
}

function signedStars(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value))}`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
