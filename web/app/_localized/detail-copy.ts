import type { AnswerCapsuleLabels } from "@/app/_explore/AnswerCapsule";
import type { CategorySummaryTableLabels } from "@/app/_explore/SemanticDataTable";
import type { ShareableSnippetLabels } from "@/app/_explore/ShareableSnippet";
import { ANSWER_CAPSULE_SOURCE, type AnswerCapsuleContent, type CapsuleRankRow } from "@/lib/geo-capsules";
import { fmtStars, formatInteger } from "@/lib/format";
import type { CategoryDimensionRegistry, CategoryRegistry, CategoryRegistryEntry } from "@/lib/contracts";
import type { Dict, Locale } from "@/lib/i18n";
import type { FaqItem } from "@/lib/jsonld";

type RankingMetric = "gained" | "total";

type DetailText = {
  completeRanking: string;
  browseAllRepositories: string;
  page: string;
  sourceSuffix: string;
  yearMetaTitle: string;
  yearMetaDescription: string;
  periodMetaTitle: string;
  periodMetaDescription: string;
  categoryIndexMetaTitle: string;
  categoryIndexMetaDescription: string;
  categoryDimensionMetaTitle: string;
  categoryDimensionMetaDescription: string;
  categoryDetailMetaTitle: string;
  categoryDetailMetaDescription: string;
  pageSuffix: string;
  repositoryRankingsCaption: string;
  completeRepositoryRankingsCaption: string;
  gainedCaption: string;
  growthCaption: string;
  crossedCaption: string;
  categorySummaryCaption: string;
  categoryDimensionSummaryCaption: string;
  categoryDetailCaption: string;
  categoryPagination: string;
  range: string;
  rankingDatasetName: string;
  rankingDatasetDescription: string;
  rankingCollectionName: string;
  rankingItemListName: string;
  rankingMetricGained: string;
  rankingMetricTotal: string;
  rankingLeader: string;
  rankingFollowers: string;
  rankingEmpty: string;
  rankingCapsule: string;
  rankingWhatQ: string;
  rankingWhatAWithAsOf: string;
  rankingWhatANoAsOf: string;
  rankingLeaderQ: string;
  rankingLeaderA: string;
  rankingLeaderFallbackA: string;
  rankingRunnerQ: string;
  rankingRunnerFallbackQ: string;
  rankingRunnerA: string;
  rankingRunnerFallbackA: string;
  rankingDataQ: string;
  rankingDataA: string;
  categoryIndexDatasetName: string;
  categoryIndexDatasetDescription: string;
  categoryIndexCollectionName: string;
  categoryIndexItemListName: string;
  categoryIndexCapsule: string;
  categoryIndexQ: string;
  categoryIndexAWithAsOf: string;
  categoryIndexANoAsOf: string;
  categoryDimensionsQ: string;
  categoryDimensionsA: string;
  categoryCountsQ: string;
  categoryCountsA: string;
  categoryMoveQ: string;
  categoryMoveAWithDimension: string;
  categoryMoveAFallback: string;
  categoryDimensionDatasetName: string;
  categoryDimensionDatasetDescription: string;
  categoryDimensionCollectionName: string;
  categoryDimensionItemListName: string;
  categoryDimensionCapsule: string;
  categoryDimensionQ: string;
  categoryDimensionAWithAsOf: string;
  categoryDimensionANoAsOf: string;
  categoryLargestQ: string;
  categoryLargestA: string;
  categoryLargestFallbackA: string;
  categoryLinksQ: string;
  categoryLinksA: string;
  categoryNoClientQ: string;
  categoryNoClientA: string;
  categoryDetailDatasetName: string;
  categoryDetailDatasetDescription: string;
  categoryDetailCollectionName: string;
  categoryDetailItemListName: string;
  categoryDetailCapsule: string;
  categoryDetailQ: string;
  categoryDetailAWithAsOf: string;
  categoryDetailANoAsOf: string;
  categoryDetailLeaderQ: string;
  categoryDetailLeaderA: string;
  categoryDetailLeaderFallbackA: string;
  categoryDetailRunnerQ: string;
  categoryDetailRunnerFallbackQ: string;
  categoryDetailRunnerA: string;
  categoryDetailRunnerFallbackA: string;
  categoryDetailDataQ: string;
  categoryDetailDataA: string;
  totalStarsValue: string;
  gainedStarsValue: string;
};

const TEXT: Record<Locale, DetailText> = {
  en: {
    completeRanking: "Complete ranking",
    browseAllRepositories: "Browse all {count} repositories",
    page: "page",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "{year} GitHub Star Rankings - Yearly Movers",
    yearMetaDescription: "The {year} ranking of GitHub repositories by stars gained, with month-by-month history.",
    periodMetaTitle: "{label} GitHub Star Rankings",
    periodMetaDescription: "GitHub repositories ranked by stars gained in {label}.",
    categoryIndexMetaTitle: "GitHub Repository Categories",
    categoryIndexMetaDescription: "Browse tracked GitHub repositories by language, ecosystem, domain, project type, owner kind, and maturity.",
    categoryDimensionMetaTitle: "{label} Categories",
    categoryDimensionMetaDescription: "Browse tracked GitHub repositories by {label}.",
    categoryDetailMetaTitle: "{label} GitHub Repository Rankings{pageSuffix}",
    categoryDetailMetaDescription: "Tracked GitHub repositories in the {label} category by current stars{pageSuffix}.",
    pageSuffix: " - Page {page}",
    repositoryRankingsCaption: "{label} GitHub repository rankings",
    completeRepositoryRankingsCaption: "Complete {label} GitHub repository rankings",
    gainedCaption: "{label} GitHub repositories by stars gained",
    growthCaption: "{label} GitHub repositories by growth rate",
    crossedCaption: "{label} GitHub repositories crossing 10k stars",
    categorySummaryCaption: "Public GitHub repository categories",
    categoryDimensionSummaryCaption: "{label} GitHub repository categories",
    categoryDetailCaption: "{label} repositories by current stars",
    categoryPagination: "{label} pagination",
    range: "{first}-{last} of {total}",
    rankingDatasetName: "GitStarClub {label} Rankings Dataset",
    rankingDatasetDescription:
      "{label} GitHub repository rankings generated from GitStarClub's precomputed ranking data where available.",
    rankingCollectionName: "{label} GitHub repository rankings",
    rankingItemListName: "{label} GitHub repository rankings",
    rankingMetricGained: "stars gained in the selected period",
    rankingMetricTotal: "current total stars",
    rankingLeader: "{repo} leads with {value}",
    rankingFollowers: ", followed by {second} and {third}",
    rankingEmpty: "the visible list is waiting for rank rows",
    rankingCapsule:
      "As of {asOf}, {title} ranks tracked GitHub repositories by {metric}. {leader}{followers}. GitStarClub generates this visible ranking from GitStarClub's precomputed ranking and repository data, without runtime search, a database, or AI.",
    rankingWhatQ: "What does {title} rank?",
    rankingWhatAWithAsOf: "As of {asOf}, {title} ranks tracked GitHub repositories by {metric}.",
    rankingWhatANoAsOf: "{title} ranks tracked GitHub repositories by {metric} from GitStarClub's precomputed ranking data.",
    rankingLeaderQ: "Which repository leads {title}?",
    rankingLeaderA: "{repo} leads {title} with {value}.",
    rankingLeaderFallbackA: "The visible {title} list is waiting for rank rows.",
    rankingRunnerQ: "Who follows {repo} in {title}?",
    rankingRunnerFallbackQ: "Does {title} include runner-up repositories?",
    rankingRunnerA: "{repo} appears next in the visible ranking with {value}.",
    rankingRunnerFallbackA: "Runner-up rows appear when the precomputed ranking has at least two repositories.",
    rankingDataQ: "Does {title} use live database queries?",
    rankingDataA: "No. GitStarClub renders {title} from GitStarClub's precomputed ranking and repository data.",
    categoryIndexDatasetName: "GitStarClub Category Registry Dataset",
    categoryIndexDatasetDescription:
      "Browse public GitHub repository categories across language, ecosystem, domain, project type, owner kind, maturity, and more.",
    categoryIndexCollectionName: "GitHub repository categories",
    categoryIndexItemListName: "GitHub repository categories",
    categoryIndexCapsule:
      "As of {asOf}, browse {categories} public GitHub categories across {dimensions} dimensions, including {labels}. GitStarClub builds these category links from deterministic rules over repository metadata, not live search or AI, so readers can reach focused repository lists through crawlable pages.",
    categoryIndexQ: "What are GitHub repository categories on GitStarClub?",
    categoryIndexAWithAsOf: "As of {asOf}, GitStarClub organizes tracked repositories into {categories} public categories across {dimensions} dimensions.",
    categoryIndexANoAsOf: "GitStarClub organizes tracked repositories into {categories} public categories across {dimensions} dimensions using deterministic category data.",
    categoryDimensionsQ: "Which category dimensions are available?",
    categoryDimensionsA: "The visible category dimensions are {labels}.",
    categoryCountsQ: "Where do category counts come from?",
    categoryCountsA: "Category counts come from GitStarClub's own category data: deterministic rules over repository metadata, not live search or AI.",
    categoryMoveQ: "How can readers move from categories to repositories?",
    categoryMoveAWithDimension: "Readers can open a dimension such as {label}, then follow a category link to a ranked repository list.",
    categoryMoveAFallback: "Readers can open any visible dimension, then follow a category link to a ranked repository list.",
    categoryDimensionDatasetName: "GitStarClub {label} Category Dataset",
    categoryDimensionDatasetDescription:
      "Browse {label} category definitions, counts, and crawlable links for tracked GitHub repositories.",
    categoryDimensionCollectionName: "{label} categories",
    categoryDimensionItemListName: "{label} categories",
    categoryDimensionCapsule:
      "As of {asOf}, GitStarClub lists {categories} public categories in the {label} dimension for tracked GitHub repositories. This page uses deterministic rules over repository metadata, not live search or AI, with crawlable links that move readers and answer engines from broad taxonomy to specific repository rankings.",
    categoryDimensionQ: "What does the {label} category page include?",
    categoryDimensionAWithAsOf: "As of {asOf}, the {label} page lists {categories} public categories for tracked GitHub repositories.",
    categoryDimensionANoAsOf: "The {label} page lists {categories} public categories for tracked GitHub repositories using deterministic category data.",
    categoryLargestQ: "Which {label} category has the most tracked repositories?",
    categoryLargestA: "{category} is the largest visible {label} category with {count} tracked repositories.",
    categoryLargestFallbackA: "No public {label} category counts are available yet.",
    categoryLinksQ: "How are {label} category links generated?",
    categoryLinksA: "GitStarClub renders {label} links from the category registry, using public flags, slugs, labels, and counts that were precomputed before the request.",
    categoryNoClientQ: "Does the {label} page run client-side filtering?",
    categoryNoClientA: "No. The {label} page is server-rendered and does not add client-side filtering logic for the visible FAQ or category links.",
    categoryDetailDatasetName: "GitStarClub {label} Repository Dataset",
    categoryDetailDatasetDescription:
      "{label} repository rankings generated from deterministic category assignments, all-time ranking data, and repository metadata.",
    categoryDetailCollectionName: "{label} repositories",
    categoryDetailItemListName: "{label} repositories",
    categoryDetailCapsule:
      "As of {asOf}, GitStarClub tracks {count} repositories in {label}. {leader}{followers}. This category ranking uses deterministic category assignments, all-time ranking data, and repository metadata.",
    categoryDetailQ: "What repositories are included in {label}?",
    categoryDetailAWithAsOf: "As of {asOf}, {label} includes {count} tracked repositories according to the category registry.",
    categoryDetailANoAsOf: "{label} includes {count} tracked repositories according to the loaded category registry.",
    categoryDetailLeaderQ: "Which repository leads {label}?",
    categoryDetailLeaderA: "{repo} leads {label} with {value}.",
    categoryDetailLeaderFallbackA: "The {label} ranking is waiting for category rank rows.",
    categoryDetailRunnerQ: "Which repository follows {repo} in {label}?",
    categoryDetailRunnerFallbackQ: "Does {label} show runner-up repositories?",
    categoryDetailRunnerA: "{repo} follows in {label} with {value}.",
    categoryDetailRunnerFallbackA: "Runner-up repositories appear when category ranking rows are available.",
    categoryDetailDataQ: "How is the {label} ranking generated?",
    categoryDetailDataA: "GitStarClub combines deterministic category assignments, all-time ranking data, and repository metadata. The page does not call live search or AI.",
    totalStarsValue: "{value} total stars",
    gainedStarsValue: "{value} stars",
  },
  ja: {
    completeRanking: "完全なランキング",
    browseAllRepositories: "{count} 件のリポジトリをすべて見る",
    page: "ページ",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "{year} GitHub スターランキング - 年間上昇",
    yearMetaDescription: "{year} 年にスターを増やした GitHub リポジトリのランキングと月別履歴。",
    periodMetaTitle: "{label} GitHub スターランキング",
    periodMetaDescription: "{label} に獲得したスター数で GitHub リポジトリを順位付けします。",
    categoryIndexMetaTitle: "GitHub リポジトリカテゴリ",
    categoryIndexMetaDescription: "追跡対象 GitHub リポジトリを言語、エコシステム、ドメイン、種類、所有者種別、成熟度で閲覧できます。",
    categoryDimensionMetaTitle: "{label} カテゴリ",
    categoryDimensionMetaDescription: "{label} で追跡対象 GitHub リポジトリを閲覧できます。",
    categoryDetailMetaTitle: "{label} GitHub リポジトリランキング{pageSuffix}",
    categoryDetailMetaDescription: "{label} カテゴリの追跡 GitHub リポジトリを現在スター数で表示します{pageSuffix}。",
    pageSuffix: " - {page} ページ",
    repositoryRankingsCaption: "{label} GitHub リポジトリランキング",
    completeRepositoryRankingsCaption: "{label} GitHub リポジトリランキング完全版",
    gainedCaption: "{label} GitHub リポジトリのスター増加順",
    growthCaption: "{label} GitHub リポジトリの成長率順",
    crossedCaption: "{label} で 1 万スターに到達した GitHub リポジトリ",
    categorySummaryCaption: "公開 GitHub リポジトリカテゴリ",
    categoryDimensionSummaryCaption: "{label} GitHub リポジトリカテゴリ",
    categoryDetailCaption: "{label} リポジトリの現在スター順",
    categoryPagination: "{label} ページ送り",
    range: "{total} 件中 {first}-{last}",
    rankingDatasetName: "GitStarClub {label} ランキングデータセット",
    rankingDatasetDescription: "利用可能な GitStarClub の事前計算ランキングデータから生成される {label} の GitHub リポジトリランキングです。",
    rankingCollectionName: "{label} GitHub リポジトリランキング",
    rankingItemListName: "{label} GitHub リポジトリランキング",
    rankingMetricGained: "選択期間に獲得したスター",
    rankingMetricTotal: "現在の総スター数",
    rankingLeader: "{repo} が {value} でリードしています",
    rankingFollowers: "、続いて {second} と {third}",
    rankingEmpty: "表示リストはランキング行を待っています",
    rankingCapsule:
      "{asOf} 時点で、{title} は追跡対象 GitHub リポジトリを{metric}で並べています。{leader}{followers}。GitStarClub は事前計算済みのランキングデータとリポジトリデータからこのランキングを生成し、実行時検索、データベース、AI は使いません。",
    rankingWhatQ: "{title} は何をランキングしていますか？",
    rankingWhatAWithAsOf: "{asOf} 時点で、{title} は追跡対象 GitHub リポジトリを{metric}で順位付けしています。",
    rankingWhatANoAsOf: "{title} は GitStarClub の事前計算ランキングデータから追跡対象 GitHub リポジトリを{metric}で順位付けします。",
    rankingLeaderQ: "{title} の首位リポジトリは？",
    rankingLeaderA: "{repo} が {title} を {value} でリードしています。",
    rankingLeaderFallbackA: "{title} の表示リストはランキング行を待っています。",
    rankingRunnerQ: "{title} で {repo} に続くリポジトリは？",
    rankingRunnerFallbackQ: "{title} には次点リポジトリがありますか？",
    rankingRunnerA: "{repo} が表示ランキングで次に並び、{value} です。",
    rankingRunnerFallbackA: "事前計算ランキングに 2 件以上のリポジトリがある場合、次点行が表示されます。",
    rankingDataQ: "{title} はライブデータベースクエリを使いますか？",
    rankingDataA: "いいえ。GitStarClub は事前計算済みのランキングデータとリポジトリデータから {title} をレンダリングします。",
    categoryIndexDatasetName: "GitStarClub カテゴリレジストリデータセット",
    categoryIndexDatasetDescription: "公開 GitHub リポジトリカテゴリを、言語、エコシステム、ドメイン、プロジェクト種別、所有者種別、成熟度などで閲覧できます。",
    categoryIndexCollectionName: "GitHub リポジトリカテゴリ",
    categoryIndexItemListName: "GitHub リポジトリカテゴリ",
    categoryIndexCapsule:
      "{asOf} 時点で、GitStarClub は追跡対象 GitHub リポジトリを {dimensions} 個の次元、{categories} 個の公開カテゴリに整理しています。例: {labels}。カテゴリリンクはリポジトリメタデータに対する決定的なルールから作られ、ライブ検索や AI ではありません。",
    categoryIndexQ: "GitStarClub の GitHub リポジトリカテゴリとは？",
    categoryIndexAWithAsOf: "{asOf} 時点で、GitStarClub は追跡リポジトリを {dimensions} 個の次元、{categories} 個の公開カテゴリに整理しています。",
    categoryIndexANoAsOf: "GitStarClub は追跡リポジトリを {dimensions} 個の次元、{categories} 個の公開カテゴリに整理します。",
    categoryDimensionsQ: "利用できるカテゴリ次元は？",
    categoryDimensionsA: "表示中のカテゴリ次元は {labels} です。",
    categoryCountsQ: "カテゴリ件数の出典は？",
    categoryCountsA: "カテゴリ件数は GitStarClub 独自のカテゴリデータに由来します。リポジトリメタデータに対する決定的なルールであり、ライブ検索や AI ではありません。",
    categoryMoveQ: "カテゴリからリポジトリへどう移動できますか？",
    categoryMoveAWithDimension: "{label} などの次元を開き、カテゴリリンクからランキング済みリポジトリ一覧へ移動できます。",
    categoryMoveAFallback: "表示されている任意の次元を開き、カテゴリリンクからランキング済みリポジトリ一覧へ移動できます。",
    categoryDimensionDatasetName: "GitStarClub {label} カテゴリデータセット",
    categoryDimensionDatasetDescription: "{label} のカテゴリ定義、件数、クロール可能なリンクを閲覧できます。",
    categoryDimensionCollectionName: "{label} カテゴリ",
    categoryDimensionItemListName: "{label} カテゴリ",
    categoryDimensionCapsule:
      "{asOf} 時点で、GitStarClub は追跡対象 GitHub リポジトリ向けに {label} 次元の公開カテゴリ {categories} 件を表示しています。このページはリポジトリメタデータに対する決定的なルールを使い、ライブ検索や AI ではなく、クロール可能なリンクでカテゴリからリポジトリランキングへ移動できます。",
    categoryDimensionQ: "{label} カテゴリページには何が含まれますか？",
    categoryDimensionAWithAsOf: "{asOf} 時点で、{label} ページは追跡 GitHub リポジトリ向けの公開カテゴリ {categories} 件を表示します。",
    categoryDimensionANoAsOf: "{label} ページは追跡 GitHub リポジトリ向けの公開カテゴリ {categories} 件を表示します。",
    categoryLargestQ: "{label} で最も追跡リポジトリが多いカテゴリは？",
    categoryLargestA: "{category} は表示中の {label} カテゴリで最大で、{count} 件の追跡リポジトリがあります。",
    categoryLargestFallbackA: "公開 {label} カテゴリ件数はまだ利用できません。",
    categoryLinksQ: "{label} カテゴリリンクはどう生成されますか？",
    categoryLinksA: "GitStarClub は事前計算された public フラグ、slug、label、count を使い、カテゴリレジストリから {label} リンクをレンダリングします。",
    categoryNoClientQ: "{label} ページはクライアント側フィルタを実行しますか？",
    categoryNoClientA: "いいえ。{label} ページはサーバーレンダリングされ、表示 FAQ やカテゴリリンクにクライアント側フィルタを追加しません。",
    categoryDetailDatasetName: "GitStarClub {label} リポジトリデータセット",
    categoryDetailDatasetDescription: "{label} リポジトリランキングは、決定的なカテゴリ割り当て、通算ランキングデータ、リポジトリ項目から生成されます。",
    categoryDetailCollectionName: "{label} リポジトリ",
    categoryDetailItemListName: "{label} リポジトリ",
    categoryDetailCapsule:
      "{asOf} 時点で、GitStarClub は {label} に {count} 件のリポジトリを追跡しています。{leader}{followers}。このカテゴリランキングは決定的なカテゴリ割り当て、通算ランキングデータ、リポジトリ項目から生成されます。",
    categoryDetailQ: "{label} にはどのリポジトリが含まれますか？",
    categoryDetailAWithAsOf: "{asOf} 時点で、{label} にはカテゴリレジストリにもとづく追跡リポジトリ {count} 件が含まれます。",
    categoryDetailANoAsOf: "{label} には読み込まれたカテゴリレジストリにもとづく追跡リポジトリ {count} 件が含まれます。",
    categoryDetailLeaderQ: "{label} の首位リポジトリは？",
    categoryDetailLeaderA: "{repo} が {label} を {value} でリードしています。",
    categoryDetailLeaderFallbackA: "{label} ランキングはカテゴリランキング行を待っています。",
    categoryDetailRunnerQ: "{label} で {repo} に続くリポジトリは？",
    categoryDetailRunnerFallbackQ: "{label} は次点リポジトリを表示しますか？",
    categoryDetailRunnerA: "{repo} が {label} で続き、{value} です。",
    categoryDetailRunnerFallbackA: "カテゴリランキング行が利用できる場合、次点リポジトリが表示されます。",
    categoryDetailDataQ: "{label} ランキングはどう生成されますか？",
    categoryDetailDataA: "GitStarClub は決定的なカテゴリ割り当て、通算ランキングデータ、リポジトリ項目を組み合わせます。このページはライブ検索や AI を呼び出しません。",
    totalStarsValue: "{value} 総スター",
    gainedStarsValue: "{value} スター",
  },
  zh: {
    completeRanking: "完整排名",
    browseAllRepositories: "浏览全部 {count} 个仓库",
    page: "页",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "{year} GitHub 星标排名 - 年度增长",
    yearMetaDescription: "{year} 年按新增星标排序的 GitHub 仓库排名，并包含逐月历史。",
    periodMetaTitle: "{label} GitHub 星标排名",
    periodMetaDescription: "按 {label} 期间新增星标排序的 GitHub 仓库。",
    categoryIndexMetaTitle: "GitHub 仓库分类",
    categoryIndexMetaDescription: "按语言、生态、领域、项目类型、所有者类型和成熟度浏览已追踪 GitHub 仓库。",
    categoryDimensionMetaTitle: "{label} 分类",
    categoryDimensionMetaDescription: "按 {label} 浏览已追踪 GitHub 仓库。",
    categoryDetailMetaTitle: "{label} GitHub 仓库排名{pageSuffix}",
    categoryDetailMetaDescription: "{label} 分类中的已追踪 GitHub 仓库，按当前星标排序{pageSuffix}。",
    pageSuffix: " - 第 {page} 页",
    repositoryRankingsCaption: "{label} GitHub 仓库排名",
    completeRepositoryRankingsCaption: "{label} GitHub 仓库完整排名",
    gainedCaption: "{label} GitHub 仓库按新增星标排序",
    growthCaption: "{label} GitHub 仓库按增长率排序",
    crossedCaption: "{label} 突破 1 万星的 GitHub 仓库",
    categorySummaryCaption: "公开 GitHub 仓库分类",
    categoryDimensionSummaryCaption: "{label} GitHub 仓库分类",
    categoryDetailCaption: "{label} 仓库按当前星标排序",
    categoryPagination: "{label} 分页",
    range: "{total} 个中的 {first}-{last}",
    rankingDatasetName: "GitStarClub {label} 排名数据集",
    rankingDatasetDescription: "{label} GitHub 仓库排名，由可用的 GitStarClub 预计算排名数据生成。",
    rankingCollectionName: "{label} GitHub 仓库排名",
    rankingItemListName: "{label} GitHub 仓库排名",
    rankingMetricGained: "所选期间新增星标",
    rankingMetricTotal: "当前总星标",
    rankingLeader: "{repo} 以 {value} 领先",
    rankingFollowers: "，随后是 {second} 和 {third}",
    rankingEmpty: "可见列表正在等待排名行",
    rankingCapsule:
      "截至 {asOf}，{title} 按{metric}为已追踪 GitHub 仓库排名。{leader}{followers}。GitStarClub 从预计算排名和仓库数据生成此可见排名，不使用运行时搜索、数据库或 AI。",
    rankingWhatQ: "{title} 排名的是什么？",
    rankingWhatAWithAsOf: "截至 {asOf}，{title} 按{metric}为已追踪 GitHub 仓库排名。",
    rankingWhatANoAsOf: "{title} 从 GitStarClub 预计算排名数据中按{metric}为已追踪 GitHub 仓库排名。",
    rankingLeaderQ: "{title} 的领先仓库是哪个？",
    rankingLeaderA: "{repo} 以 {value} 领先 {title}。",
    rankingLeaderFallbackA: "{title} 的可见列表正在等待排名行。",
    rankingRunnerQ: "{title} 中谁跟随 {repo}？",
    rankingRunnerFallbackQ: "{title} 是否包含后续仓库？",
    rankingRunnerA: "{repo} 以 {value} 出现在可见排名下一位。",
    rankingRunnerFallbackA: "当预计算排名至少有两个仓库时，会显示后续行。",
    rankingDataQ: "{title} 使用实时数据库查询吗？",
    rankingDataA: "不使用。GitStarClub 从预计算排名和仓库数据渲染 {title}。",
    categoryIndexDatasetName: "GitStarClub 分类注册表数据集",
    categoryIndexDatasetDescription: "按语言、生态、领域、项目类型、所有者类型、成熟度等浏览公开 GitHub 仓库分类。",
    categoryIndexCollectionName: "GitHub 仓库分类",
    categoryIndexItemListName: "GitHub 仓库分类",
    categoryIndexCapsule:
      "截至 {asOf}，GitStarClub 将已追踪 GitHub 仓库整理为 {dimensions} 个维度下的 {categories} 个公开分类，包括 {labels}。分类链接由基于仓库元数据的确定性规则生成，而不是实时搜索或 AI。",
    categoryIndexQ: "GitStarClub 上的 GitHub 仓库分类是什么？",
    categoryIndexAWithAsOf: "截至 {asOf}，GitStarClub 将已追踪仓库整理为 {dimensions} 个维度下的 {categories} 个公开分类。",
    categoryIndexANoAsOf: "GitStarClub 将已追踪仓库整理为 {dimensions} 个维度下的 {categories} 个公开分类。",
    categoryDimensionsQ: "有哪些分类维度？",
    categoryDimensionsA: "可见分类维度是 {labels}。",
    categoryCountsQ: "分类计数来自哪里？",
    categoryCountsA: "分类计数来自 GitStarClub 自有分类数据：基于仓库元数据的确定性规则，而不是实时搜索或 AI。",
    categoryMoveQ: "读者如何从分类进入仓库？",
    categoryMoveAWithDimension: "读者可以打开 {label} 等维度，再跟随分类链接进入已排名仓库列表。",
    categoryMoveAFallback: "读者可以打开任意可见维度，再跟随分类链接进入已排名仓库列表。",
    categoryDimensionDatasetName: "GitStarClub {label} 分类数据集",
    categoryDimensionDatasetDescription: "浏览 {label} 分类定义、计数和面向已追踪 GitHub 仓库的可抓取链接。",
    categoryDimensionCollectionName: "{label} 分类",
    categoryDimensionItemListName: "{label} 分类",
    categoryDimensionCapsule:
      "截至 {asOf}，GitStarClub 为已追踪 GitHub 仓库列出 {label} 维度下的 {categories} 个公开分类。该页面使用基于仓库元数据的确定性规则，而不是实时搜索或 AI，并用可抓取链接帮助读者从分类进入具体仓库排名。",
    categoryDimensionQ: "{label} 分类页包含什么？",
    categoryDimensionAWithAsOf: "截至 {asOf}，{label} 页面列出已追踪 GitHub 仓库的 {categories} 个公开分类。",
    categoryDimensionANoAsOf: "{label} 页面列出已追踪 GitHub 仓库的 {categories} 个公开分类。",
    categoryLargestQ: "哪个 {label} 分类的追踪仓库最多？",
    categoryLargestA: "{category} 是可见 {label} 分类中最大的一个，有 {count} 个追踪仓库。",
    categoryLargestFallbackA: "暂无公开 {label} 分类计数。",
    categoryLinksQ: "{label} 分类链接如何生成？",
    categoryLinksA: "GitStarClub 使用请求前已预计算的 public 标记、slug、label 和 count，从分类注册表渲染 {label} 链接。",
    categoryNoClientQ: "{label} 页面会运行客户端过滤吗？",
    categoryNoClientA: "不会。{label} 页面由服务器渲染，不为可见 FAQ 或分类链接添加客户端过滤逻辑。",
    categoryDetailDatasetName: "GitStarClub {label} 仓库数据集",
    categoryDetailDatasetDescription: "{label} 仓库排名由确定性分类分配、历史总榜数据和仓库字段生成。",
    categoryDetailCollectionName: "{label} 仓库",
    categoryDetailItemListName: "{label} 仓库",
    categoryDetailCapsule:
      "截至 {asOf}，GitStarClub 在 {label} 中追踪 {count} 个仓库。{leader}{followers}。该分类排名由确定性分类分配、历史总榜数据和仓库字段生成。",
    categoryDetailQ: "{label} 中包含哪些仓库？",
    categoryDetailAWithAsOf: "截至 {asOf}，根据分类注册表，{label} 包含 {count} 个已追踪仓库。",
    categoryDetailANoAsOf: "根据已加载的分类注册表，{label} 包含 {count} 个已追踪仓库。",
    categoryDetailLeaderQ: "{label} 的领先仓库是哪个？",
    categoryDetailLeaderA: "{repo} 以 {value} 领先 {label}。",
    categoryDetailLeaderFallbackA: "{label} 排名正在等待分类排名行。",
    categoryDetailRunnerQ: "{label} 中谁跟随 {repo}？",
    categoryDetailRunnerFallbackQ: "{label} 是否显示后续仓库？",
    categoryDetailRunnerA: "{repo} 在 {label} 中随后，当前为 {value}。",
    categoryDetailRunnerFallbackA: "分类排名行可用时会显示后续仓库。",
    categoryDetailDataQ: "{label} 排名如何生成？",
    categoryDetailDataA: "GitStarClub 组合确定性分类分配、历史总榜数据和仓库字段。该页面不会调用实时搜索或 AI。",
    totalStarsValue: "{value} 总星标",
    gainedStarsValue: "{value} 星",
  },
  "zh-TW": {
    completeRanking: "完整排名",
    browseAllRepositories: "瀏覽全部 {count} 個倉庫",
    page: "頁",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "{year} GitHub 星標排名 - 年度成長",
    yearMetaDescription: "{year} 年依新增星標排序的 GitHub 倉庫排名，並包含逐月歷史。",
    periodMetaTitle: "{label} GitHub 星標排名",
    periodMetaDescription: "依 {label} 期間新增星標排序的 GitHub 倉庫。",
    categoryIndexMetaTitle: "GitHub 倉庫分類",
    categoryIndexMetaDescription: "依語言、生態、領域、專案類型、擁有者類型和成熟度瀏覽已追蹤 GitHub 倉庫。",
    categoryDimensionMetaTitle: "{label} 分類",
    categoryDimensionMetaDescription: "依 {label} 瀏覽已追蹤 GitHub 倉庫。",
    categoryDetailMetaTitle: "{label} GitHub 倉庫排名{pageSuffix}",
    categoryDetailMetaDescription: "{label} 分類中的已追蹤 GitHub 倉庫，依目前星標排序{pageSuffix}。",
    pageSuffix: " - 第 {page} 頁",
    repositoryRankingsCaption: "{label} GitHub 倉庫排名",
    completeRepositoryRankingsCaption: "{label} GitHub 倉庫完整排名",
    gainedCaption: "{label} GitHub 倉庫依新增星標排序",
    growthCaption: "{label} GitHub 倉庫依成長率排序",
    crossedCaption: "{label} 突破 1 萬星的 GitHub 倉庫",
    categorySummaryCaption: "公開 GitHub 倉庫分類",
    categoryDimensionSummaryCaption: "{label} GitHub 倉庫分類",
    categoryDetailCaption: "{label} 倉庫依目前星標排序",
    categoryPagination: "{label} 分頁",
    range: "{total} 個中的 {first}-{last}",
    rankingDatasetName: "GitStarClub {label} 排名資料集",
    rankingDatasetDescription: "{label} GitHub 倉庫排名，由可用的 GitStarClub 預先計算排名資料產生。",
    rankingCollectionName: "{label} GitHub 倉庫排名",
    rankingItemListName: "{label} GitHub 倉庫排名",
    rankingMetricGained: "所選期間新增星標",
    rankingMetricTotal: "目前總星標",
    rankingLeader: "{repo} 以 {value} 領先",
    rankingFollowers: "，隨後是 {second} 和 {third}",
    rankingEmpty: "可見列表正在等待排名列",
    rankingCapsule:
      "截至 {asOf}，{title} 依{metric}為已追蹤 GitHub 倉庫排名。{leader}{followers}。GitStarClub 從預先計算排名和倉庫資料產生此可見排名，不使用執行時搜尋、資料庫或 AI。",
    rankingWhatQ: "{title} 排名的是什麼？",
    rankingWhatAWithAsOf: "截至 {asOf}，{title} 依{metric}為已追蹤 GitHub 倉庫排名。",
    rankingWhatANoAsOf: "{title} 從 GitStarClub 預先計算排名資料中依{metric}為已追蹤 GitHub 倉庫排名。",
    rankingLeaderQ: "{title} 的領先倉庫是哪個？",
    rankingLeaderA: "{repo} 以 {value} 領先 {title}。",
    rankingLeaderFallbackA: "{title} 的可見列表正在等待排名列。",
    rankingRunnerQ: "{title} 中誰跟隨 {repo}？",
    rankingRunnerFallbackQ: "{title} 是否包含後續倉庫？",
    rankingRunnerA: "{repo} 以 {value} 出現在可見排名下一位。",
    rankingRunnerFallbackA: "當預先計算排名至少有兩個倉庫時，會顯示後續列。",
    rankingDataQ: "{title} 使用即時資料庫查詢嗎？",
    rankingDataA: "不使用。GitStarClub 從預先計算排名和倉庫資料渲染 {title}。",
    categoryIndexDatasetName: "GitStarClub 分類註冊表資料集",
    categoryIndexDatasetDescription: "按語言、生態系、領域、專案類型、擁有者類型、成熟度等瀏覽公開 GitHub 倉庫分類。",
    categoryIndexCollectionName: "GitHub 倉庫分類",
    categoryIndexItemListName: "GitHub 倉庫分類",
    categoryIndexCapsule:
      "截至 {asOf}，GitStarClub 將已追蹤 GitHub 倉庫整理為 {dimensions} 個維度下的 {categories} 個公開分類，包括 {labels}。分類連結由基於倉庫中繼資料的確定性規則產生，而不是即時搜尋或 AI。",
    categoryIndexQ: "GitStarClub 上的 GitHub 倉庫分類是什麼？",
    categoryIndexAWithAsOf: "截至 {asOf}，GitStarClub 將已追蹤倉庫整理為 {dimensions} 個維度下的 {categories} 個公開分類。",
    categoryIndexANoAsOf: "GitStarClub 將已追蹤倉庫整理為 {dimensions} 個維度下的 {categories} 個公開分類。",
    categoryDimensionsQ: "有哪些分類維度？",
    categoryDimensionsA: "可見分類維度是 {labels}。",
    categoryCountsQ: "分類計數來自哪裡？",
    categoryCountsA: "分類計數來自 GitStarClub 自有分類資料：基於倉庫中繼資料的確定性規則，而不是即時搜尋或 AI。",
    categoryMoveQ: "讀者如何從分類進入倉庫？",
    categoryMoveAWithDimension: "讀者可以開啟 {label} 等維度，再跟隨分類連結進入已排名倉庫列表。",
    categoryMoveAFallback: "讀者可以開啟任意可見維度，再跟隨分類連結進入已排名倉庫列表。",
    categoryDimensionDatasetName: "GitStarClub {label} 分類資料集",
    categoryDimensionDatasetDescription: "瀏覽 {label} 分類定義、計數和面向已追蹤 GitHub 倉庫的可抓取連結。",
    categoryDimensionCollectionName: "{label} 分類",
    categoryDimensionItemListName: "{label} 分類",
    categoryDimensionCapsule:
      "截至 {asOf}，GitStarClub 為已追蹤 GitHub 倉庫列出 {label} 維度下的 {categories} 個公開分類。此頁面使用基於倉庫中繼資料的確定性規則，而不是即時搜尋或 AI，並用可抓取連結幫助讀者從分類進入具體倉庫排名。",
    categoryDimensionQ: "{label} 分類頁包含什麼？",
    categoryDimensionAWithAsOf: "截至 {asOf}，{label} 頁面列出已追蹤 GitHub 倉庫的 {categories} 個公開分類。",
    categoryDimensionANoAsOf: "{label} 頁面列出已追蹤 GitHub 倉庫的 {categories} 個公開分類。",
    categoryLargestQ: "哪個 {label} 分類的追蹤倉庫最多？",
    categoryLargestA: "{category} 是可見 {label} 分類中最大的，有 {count} 個追蹤倉庫。",
    categoryLargestFallbackA: "暫無公開 {label} 分類計數。",
    categoryLinksQ: "{label} 分類連結如何產生？",
    categoryLinksA: "GitStarClub 使用請求前已預先計算的 public 標記、slug、label 和 count，從分類註冊表渲染 {label} 連結。",
    categoryNoClientQ: "{label} 頁面會執行客戶端篩選嗎？",
    categoryNoClientA: "不會。{label} 頁面由伺服器渲染，不為可見 FAQ 或分類連結加入客戶端篩選邏輯。",
    categoryDetailDatasetName: "GitStarClub {label} 倉庫資料集",
    categoryDetailDatasetDescription: "{label} 倉庫排名由確定性分類分配、歷史總榜資料和倉庫欄位產生。",
    categoryDetailCollectionName: "{label} 倉庫",
    categoryDetailItemListName: "{label} 倉庫",
    categoryDetailCapsule:
      "截至 {asOf}，GitStarClub 在 {label} 中追蹤 {count} 個倉庫。{leader}{followers}。此分類排名由確定性分類分配、歷史總榜資料和倉庫欄位產生。",
    categoryDetailQ: "{label} 中包含哪些倉庫？",
    categoryDetailAWithAsOf: "截至 {asOf}，根據分類註冊表，{label} 包含 {count} 個已追蹤倉庫。",
    categoryDetailANoAsOf: "根據已載入的分類註冊表，{label} 包含 {count} 個已追蹤倉庫。",
    categoryDetailLeaderQ: "{label} 的領先倉庫是哪個？",
    categoryDetailLeaderA: "{repo} 以 {value} 領先 {label}。",
    categoryDetailLeaderFallbackA: "{label} 排名正在等待分類排名列。",
    categoryDetailRunnerQ: "{label} 中誰跟隨 {repo}？",
    categoryDetailRunnerFallbackQ: "{label} 是否顯示後續倉庫？",
    categoryDetailRunnerA: "{repo} 在 {label} 中隨後，目前為 {value}。",
    categoryDetailRunnerFallbackA: "分類排名列可用時會顯示後續倉庫。",
    categoryDetailDataQ: "{label} 排名如何產生？",
    categoryDetailDataA: "GitStarClub 組合確定性分類分配、歷史總榜資料和倉庫欄位。此頁面不會呼叫即時搜尋或 AI。",
    totalStarsValue: "{value} 總星標",
    gainedStarsValue: "{value} 星",
  },
  ko: {
    completeRanking: "전체 순위",
    browseAllRepositories: "저장소 {count}개 모두 보기",
    page: "페이지",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "{year} GitHub 스타 순위 - 연간 상승",
    yearMetaDescription: "{year}년에 스타를 얻은 GitHub 저장소 순위와 월별 히스토리입니다.",
    periodMetaTitle: "{label} GitHub 스타 순위",
    periodMetaDescription: "{label} 동안 얻은 스타 수로 GitHub 저장소를 정렬합니다.",
    categoryIndexMetaTitle: "GitHub 저장소 카테고리",
    categoryIndexMetaDescription: "언어, 생태계, 도메인, 프로젝트 유형, 소유자 유형, 성숙도로 추적 GitHub 저장소를 탐색합니다.",
    categoryDimensionMetaTitle: "{label} 카테고리",
    categoryDimensionMetaDescription: "{label} 기준으로 추적 GitHub 저장소를 탐색합니다.",
    categoryDetailMetaTitle: "{label} GitHub 저장소 순위{pageSuffix}",
    categoryDetailMetaDescription: "{label} 카테고리의 추적 GitHub 저장소를 현재 스타 순으로 보여줍니다{pageSuffix}.",
    pageSuffix: " - {page}페이지",
    repositoryRankingsCaption: "{label} GitHub 저장소 순위",
    completeRepositoryRankingsCaption: "{label} GitHub 저장소 전체 순위",
    gainedCaption: "{label} GitHub 저장소 스타 증가 순위",
    growthCaption: "{label} GitHub 저장소 성장률 순위",
    crossedCaption: "{label}에서 1만 스타를 넘은 GitHub 저장소",
    categorySummaryCaption: "공개 GitHub 저장소 카테고리",
    categoryDimensionSummaryCaption: "{label} GitHub 저장소 카테고리",
    categoryDetailCaption: "{label} 저장소 현재 스타 순위",
    categoryPagination: "{label} 페이지 이동",
    range: "총 {total}개 중 {first}-{last}",
    rankingDatasetName: "GitStarClub {label} 순위 데이터셋",
    rankingDatasetDescription: "{label} GitHub 저장소 순위는 사용 가능한 GitStarClub의 사전 계산 순위 데이터에서 생성됩니다.",
    rankingCollectionName: "{label} GitHub 저장소 순위",
    rankingItemListName: "{label} GitHub 저장소 순위",
    rankingMetricGained: "선택 기간에 얻은 스타",
    rankingMetricTotal: "현재 총 스타",
    rankingLeader: "{repo}가 {value}로 앞서고 있습니다",
    rankingFollowers: ", 이어서 {second} 및 {third}",
    rankingEmpty: "표시 목록은 순위 행을 기다리고 있습니다",
    rankingCapsule:
      "{asOf} 기준으로 {title}은 추적 GitHub 저장소를 {metric} 기준으로 정렬합니다. {leader}{followers}. GitStarClub은 런타임 검색, 데이터베이스, AI 없이 사전 계산 순위 및 저장소 데이터로 이 순위를 생성합니다.",
    rankingWhatQ: "{title}은 무엇을 순위화하나요?",
    rankingWhatAWithAsOf: "{asOf} 기준으로 {title}은 추적 GitHub 저장소를 {metric} 기준으로 순위화합니다.",
    rankingWhatANoAsOf: "{title}은 GitStarClub의 사전 계산 순위 데이터에서 추적 GitHub 저장소를 {metric} 기준으로 순위화합니다.",
    rankingLeaderQ: "{title}을 이끄는 저장소는 무엇인가요?",
    rankingLeaderA: "{repo}가 {value}로 {title}을 이끌고 있습니다.",
    rankingLeaderFallbackA: "{title} 표시 목록은 순위 행을 기다리고 있습니다.",
    rankingRunnerQ: "{title}에서 {repo} 다음은 무엇인가요?",
    rankingRunnerFallbackQ: "{title}에는 후속 저장소가 포함되나요?",
    rankingRunnerA: "{repo}가 {value}로 표시 순위 다음에 있습니다.",
    rankingRunnerFallbackA: "사전 계산 순위에 저장소가 두 개 이상 있으면 후속 행이 표시됩니다.",
    rankingDataQ: "{title}은 실시간 데이터베이스 쿼리를 사용하나요?",
    rankingDataA: "아니요. GitStarClub은 사전 계산 순위 및 저장소 데이터에서 {title}을 렌더링합니다.",
    categoryIndexDatasetName: "GitStarClub 카테고리 레지스트리 데이터셋",
    categoryIndexDatasetDescription: "언어, 생태계, 도메인, 프로젝트 유형, 소유자 유형, 성숙도 등으로 공개 GitHub 저장소 카테고리를 둘러보세요.",
    categoryIndexCollectionName: "GitHub 저장소 카테고리",
    categoryIndexItemListName: "GitHub 저장소 카테고리",
    categoryIndexCapsule:
      "{asOf} 기준으로 GitStarClub은 추적 GitHub 저장소를 {dimensions}개 차원, {categories}개 공개 카테고리로 정리합니다. 예: {labels}. 카테고리 링크는 저장소 메타데이터에 대한 결정적 규칙에서 생성되며 실시간 검색이나 AI가 아닙니다.",
    categoryIndexQ: "GitStarClub의 GitHub 저장소 카테고리는 무엇인가요?",
    categoryIndexAWithAsOf: "{asOf} 기준으로 GitStarClub은 추적 저장소를 {dimensions}개 차원, {categories}개 공개 카테고리로 정리합니다.",
    categoryIndexANoAsOf: "GitStarClub은 추적 저장소를 {dimensions}개 차원, {categories}개 공개 카테고리로 정리합니다.",
    categoryDimensionsQ: "사용 가능한 카테고리 차원은 무엇인가요?",
    categoryDimensionsA: "표시되는 카테고리 차원은 {labels}입니다.",
    categoryCountsQ: "카테고리 수는 어디서 오나요?",
    categoryCountsA: "카테고리 수는 GitStarClub의 자체 카테고리 데이터에서 옵니다. 저장소 메타데이터에 대한 결정적 규칙이며 실시간 검색이나 AI가 아닙니다.",
    categoryMoveQ: "카테고리에서 저장소로 어떻게 이동하나요?",
    categoryMoveAWithDimension: "{label} 같은 차원을 열고 카테고리 링크를 따라 순위화된 저장소 목록으로 이동할 수 있습니다.",
    categoryMoveAFallback: "표시된 차원을 열고 카테고리 링크를 따라 순위화된 저장소 목록으로 이동할 수 있습니다.",
    categoryDimensionDatasetName: "GitStarClub {label} 카테고리 데이터셋",
    categoryDimensionDatasetDescription: "추적 GitHub 저장소를 위한 {label} 카테고리 정의, 수, 크롤 가능한 링크를 둘러보세요.",
    categoryDimensionCollectionName: "{label} 카테고리",
    categoryDimensionItemListName: "{label} 카테고리",
    categoryDimensionCapsule:
      "{asOf} 기준으로 GitStarClub은 추적 GitHub 저장소의 {label} 차원에 공개 카테고리 {categories}개를 표시합니다. 이 페이지는 저장소 메타데이터에 대한 결정적 규칙을 사용하며 실시간 검색이나 AI가 아니고, 크롤 가능한 링크로 카테고리에서 저장소 순위로 이동할 수 있게 합니다.",
    categoryDimensionQ: "{label} 카테고리 페이지에는 무엇이 포함되나요?",
    categoryDimensionAWithAsOf: "{asOf} 기준으로 {label} 페이지는 추적 GitHub 저장소의 공개 카테고리 {categories}개를 표시합니다.",
    categoryDimensionANoAsOf: "{label} 페이지는 추적 GitHub 저장소의 공개 카테고리 {categories}개를 표시합니다.",
    categoryLargestQ: "어떤 {label} 카테고리에 추적 저장소가 가장 많나요?",
    categoryLargestA: "{category}는 표시된 {label} 카테고리 중 가장 크며 추적 저장소 {count}개가 있습니다.",
    categoryLargestFallbackA: "공개 {label} 카테고리 수는 아직 사용할 수 없습니다.",
    categoryLinksQ: "{label} 카테고리 링크는 어떻게 생성되나요?",
    categoryLinksA: "GitStarClub은 요청 전에 사전 계산된 public 플래그, slug, label, count를 사용해 카테고리 레지스트리에서 {label} 링크를 렌더링합니다.",
    categoryNoClientQ: "{label} 페이지는 클라이언트 필터링을 실행하나요?",
    categoryNoClientA: "아니요. {label} 페이지는 서버 렌더링되며 표시 FAQ나 카테고리 링크에 클라이언트 필터링을 추가하지 않습니다.",
    categoryDetailDatasetName: "GitStarClub {label} 저장소 데이터셋",
    categoryDetailDatasetDescription: "{label} 저장소 순위는 결정적 카테고리 할당, 역대 순위 데이터, 저장소 필드에서 생성됩니다.",
    categoryDetailCollectionName: "{label} 저장소",
    categoryDetailItemListName: "{label} 저장소",
    categoryDetailCapsule:
      "{asOf} 기준으로 GitStarClub은 {label}에서 저장소 {count}개를 추적합니다. {leader}{followers}. 이 카테고리 순위는 결정적 카테고리 할당, 역대 순위 데이터, 저장소 필드에서 생성됩니다.",
    categoryDetailQ: "{label}에는 어떤 저장소가 포함되나요?",
    categoryDetailAWithAsOf: "{asOf} 기준으로 {label}에는 카테고리 레지스트리에 따른 추적 저장소 {count}개가 포함됩니다.",
    categoryDetailANoAsOf: "{label}에는 로드된 카테고리 레지스트리에 따른 추적 저장소 {count}개가 포함됩니다.",
    categoryDetailLeaderQ: "{label}을 이끄는 저장소는 무엇인가요?",
    categoryDetailLeaderA: "{repo}가 {value}로 {label}을 이끌고 있습니다.",
    categoryDetailLeaderFallbackA: "{label} 순위는 카테고리 순위 행을 기다리고 있습니다.",
    categoryDetailRunnerQ: "{label}에서 {repo} 다음은 무엇인가요?",
    categoryDetailRunnerFallbackQ: "{label}은 후속 저장소를 표시하나요?",
    categoryDetailRunnerA: "{repo}가 {label}에서 뒤따르며 {value}입니다.",
    categoryDetailRunnerFallbackA: "카테고리 순위 행이 있으면 후속 저장소가 표시됩니다.",
    categoryDetailDataQ: "{label} 순위는 어떻게 생성되나요?",
    categoryDetailDataA: "GitStarClub은 결정적 카테고리 할당, 역대 순위 데이터, 저장소 필드를 결합합니다. 이 페이지는 실시간 검색이나 AI를 호출하지 않습니다.",
    totalStarsValue: "{value} 총 스타",
    gainedStarsValue: "{value} 스타",
  },
  es: {
    completeRanking: "Ranking completo",
    browseAllRepositories: "Ver los {count} repositorios",
    page: "página",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "Ranking de estrellas GitHub {year} - crecimiento anual",
    yearMetaDescription: "Ranking {year} de repositorios GitHub por estrellas ganadas, con historia mes a mes.",
    periodMetaTitle: "Ranking de estrellas GitHub {label}",
    periodMetaDescription: "Repositorios GitHub ordenados por estrellas ganadas en {label}.",
    categoryIndexMetaTitle: "Categorías de repositorios GitHub",
    categoryIndexMetaDescription: "Explora repositorios GitHub monitoreados por lenguaje, ecosistema, dominio, tipo de proyecto, tipo de dueño y madurez.",
    categoryDimensionMetaTitle: "Categorías {label}",
    categoryDimensionMetaDescription: "Explora repositorios GitHub monitoreados por {label}.",
    categoryDetailMetaTitle: "Ranking de repositorios GitHub {label}{pageSuffix}",
    categoryDetailMetaDescription: "Repositorios GitHub monitoreados en la categoría {label}, ordenados por estrellas actuales{pageSuffix}.",
    pageSuffix: " - página {page}",
    repositoryRankingsCaption: "Ranking de repositorios GitHub {label}",
    completeRepositoryRankingsCaption: "Ranking completo de repositorios GitHub {label}",
    gainedCaption: "Repositorios GitHub {label} por estrellas ganadas",
    growthCaption: "Repositorios GitHub {label} por tasa de crecimiento",
    crossedCaption: "Repositorios GitHub que cruzaron 10k estrellas en {label}",
    categorySummaryCaption: "Categorías públicas de repositorios GitHub",
    categoryDimensionSummaryCaption: "Categorías de repositorios GitHub {label}",
    categoryDetailCaption: "Repositorios {label} por estrellas actuales",
    categoryPagination: "Paginación de {label}",
    range: "{first}-{last} de {total}",
    rankingDatasetName: "Dataset de rankings GitStarClub {label}",
    rankingDatasetDescription: "Rankings de repositorios GitHub {label} generados desde datos de ranking precalculados de GitStarClub cuando están disponibles.",
    rankingCollectionName: "Rankings de repositorios GitHub {label}",
    rankingItemListName: "Rankings de repositorios GitHub {label}",
    rankingMetricGained: "estrellas ganadas en el periodo seleccionado",
    rankingMetricTotal: "estrellas totales actuales",
    rankingLeader: "{repo} lidera con {value}",
    rankingFollowers: ", seguido por {second} y {third}",
    rankingEmpty: "la lista visible espera filas de ranking",
    rankingCapsule:
      "Al {asOf}, {title} ordena repositorios GitHub monitoreados por {metric}. {leader}{followers}. GitStarClub genera este ranking visible desde datos precalculados de ranking y repositorios, sin búsqueda, base de datos ni IA en tiempo de ejecución.",
    rankingWhatQ: "¿Qué ordena {title}?",
    rankingWhatAWithAsOf: "Al {asOf}, {title} ordena repositorios GitHub monitoreados por {metric}.",
    rankingWhatANoAsOf: "GitStarClub ordena en {title} repositorios GitHub monitoreados por {metric} desde datos de ranking precalculados.",
    rankingLeaderQ: "¿Qué repositorio lidera {title}?",
    rankingLeaderA: "{repo} lidera {title} con {value}.",
    rankingLeaderFallbackA: "La lista visible de {title} espera filas de ranking.",
    rankingRunnerQ: "¿Quién sigue a {repo} en {title}?",
    rankingRunnerFallbackQ: "¿{title} incluye repositorios de seguimiento?",
    rankingRunnerA: "{repo} aparece después en el ranking visible con {value}.",
    rankingRunnerFallbackA: "Las filas siguientes aparecen cuando el ranking precalculado tiene al menos dos repositorios.",
    rankingDataQ: "¿{title} usa consultas de base de datos en vivo?",
    rankingDataA: "No. GitStarClub renderiza {title} desde datos precalculados de ranking y repositorios.",
    categoryIndexDatasetName: "Dataset de registro de categorías GitStarClub",
    categoryIndexDatasetDescription: "Explore categorías públicas de repositorios GitHub por lenguaje, ecosistema, dominio, tipo de proyecto, tipo de propietario, madurez y más.",
    categoryIndexCollectionName: "Categorías de repositorios GitHub",
    categoryIndexItemListName: "Categorías de repositorios GitHub",
    categoryIndexCapsule:
      "Al {asOf}, GitStarClub organiza repositorios GitHub monitoreados en {categories} categorías públicas dentro de {dimensions} dimensiones, incluidas {labels}. Los enlaces de categoría se generan con reglas deterministas sobre metadatos de repositorios, no con búsqueda en vivo ni IA.",
    categoryIndexQ: "¿Qué son las categorías de repositorios GitHub en GitStarClub?",
    categoryIndexAWithAsOf: "Al {asOf}, GitStarClub organiza repositorios monitoreados en {categories} categorías públicas dentro de {dimensions} dimensiones.",
    categoryIndexANoAsOf: "GitStarClub organiza repositorios monitoreados en {categories} categorías públicas dentro de {dimensions} dimensiones.",
    categoryDimensionsQ: "¿Qué dimensiones de categoría están disponibles?",
    categoryDimensionsA: "Las dimensiones visibles son {labels}.",
    categoryCountsQ: "¿De dónde vienen los conteos de categoría?",
    categoryCountsA: "Los conteos vienen de los datos de categorías propios de GitStarClub: reglas deterministas sobre metadatos de repositorios, no búsqueda en vivo ni IA.",
    categoryMoveQ: "¿Cómo pasan los lectores de categorías a repositorios?",
    categoryMoveAWithDimension: "Los lectores pueden abrir una dimensión como {label} y seguir un enlace de categoría a una lista de repositorios rankeados.",
    categoryMoveAFallback: "Los lectores pueden abrir cualquier dimensión visible y seguir un enlace de categoría a una lista de repositorios rankeados.",
    categoryDimensionDatasetName: "Dataset de categorías GitStarClub {label}",
    categoryDimensionDatasetDescription: "Explore definiciones, conteos y enlaces rastreables de {label} para repositorios GitHub monitoreados.",
    categoryDimensionCollectionName: "Categorías {label}",
    categoryDimensionItemListName: "Categorías {label}",
    categoryDimensionCapsule:
      "Al {asOf}, GitStarClub lista {categories} categorías públicas en la dimensión {label} para repositorios GitHub monitoreados. Esta página usa reglas deterministas sobre metadatos de repositorios, no búsqueda en vivo ni IA, con enlaces rastreables que llevan de la taxonomía a rankings específicos.",
    categoryDimensionQ: "¿Qué incluye la página de categoría {label}?",
    categoryDimensionAWithAsOf: "Al {asOf}, la página {label} lista {categories} categorías públicas para repositorios GitHub monitoreados.",
    categoryDimensionANoAsOf: "La página {label} lista {categories} categorías públicas para repositorios GitHub monitoreados.",
    categoryLargestQ: "¿Qué categoría {label} tiene más repositorios monitoreados?",
    categoryLargestA: "{category} es la mayor categoría visible de {label} con {count} repositorios monitoreados.",
    categoryLargestFallbackA: "Aún no hay conteos públicos de categoría {label}.",
    categoryLinksQ: "¿Cómo se generan los enlaces de categoría {label}?",
    categoryLinksA: "GitStarClub renderiza enlaces {label} desde el registro de categorías, usando flags públicos, slugs, etiquetas y conteos precalculados antes de la solicitud.",
    categoryNoClientQ: "¿La página {label} ejecuta filtrado del lado del cliente?",
    categoryNoClientA: "No. La página {label} se renderiza en servidor y no agrega filtrado cliente para la FAQ visible ni enlaces de categoría.",
    categoryDetailDatasetName: "Dataset de repositorios GitStarClub {label}",
    categoryDetailDatasetDescription: "Rankings de repositorios {label} generados desde asignaciones deterministas de categoría, datos de ranking histórico y campos de repositorio.",
    categoryDetailCollectionName: "Repositorios {label}",
    categoryDetailItemListName: "Repositorios {label}",
    categoryDetailCapsule:
      "Al {asOf}, GitStarClub monitorea {count} repositorios en {label}. {leader}{followers}. Este ranking de categoría usa asignaciones deterministas de categoría, datos de ranking histórico y campos de repositorio.",
    categoryDetailQ: "¿Qué repositorios se incluyen en {label}?",
    categoryDetailAWithAsOf: "Al {asOf}, {label} incluye {count} repositorios monitoreados según el registro de categorías.",
    categoryDetailANoAsOf: "{label} incluye {count} repositorios monitoreados según el registro de categorías cargado.",
    categoryDetailLeaderQ: "¿Qué repositorio lidera {label}?",
    categoryDetailLeaderA: "{repo} lidera {label} con {value}.",
    categoryDetailLeaderFallbackA: "El ranking {label} espera filas de ranking de categoría.",
    categoryDetailRunnerQ: "¿Qué repositorio sigue a {repo} en {label}?",
    categoryDetailRunnerFallbackQ: "¿{label} muestra repositorios de seguimiento?",
    categoryDetailRunnerA: "{repo} sigue en {label} con {value}.",
    categoryDetailRunnerFallbackA: "Los repositorios siguientes aparecen cuando hay filas de ranking de categoría disponibles.",
    categoryDetailDataQ: "¿Cómo se genera el ranking {label}?",
    categoryDetailDataA: "GitStarClub combina asignaciones deterministas de categoría, ranking histórico y campos de repositorio. La página no llama búsqueda en vivo ni IA.",
    totalStarsValue: "{value} estrellas totales",
    gainedStarsValue: "{value} estrellas",
  },
  fr: {
    completeRanking: "Classement complet",
    browseAllRepositories: "Voir les {count} dépôts",
    page: "page",
    sourceSuffix: " - GitStarClub",
    yearMetaTitle: "Classement d'étoiles GitHub {year} - progression annuelle",
    yearMetaDescription: "Le classement {year} des dépôts GitHub par étoiles gagnées, avec un historique mois par mois.",
    periodMetaTitle: "Classement d'étoiles GitHub {label}",
    periodMetaDescription: "Dépôts GitHub classés par étoiles gagnées pendant {label}.",
    categoryIndexMetaTitle: "Catégories de dépôts GitHub",
    categoryIndexMetaDescription: "Parcourez les dépôts GitHub suivis par langage, écosystème, domaine, type de projet, type de propriétaire et maturité.",
    categoryDimensionMetaTitle: "Catégories {label}",
    categoryDimensionMetaDescription: "Parcourez les dépôts GitHub suivis par {label}.",
    categoryDetailMetaTitle: "Classement des dépôts GitHub {label}{pageSuffix}",
    categoryDetailMetaDescription: "Dépôts GitHub suivis dans la catégorie {label}, classés par étoiles actuelles{pageSuffix}.",
    pageSuffix: " - page {page}",
    repositoryRankingsCaption: "Classement des dépôts GitHub {label}",
    completeRepositoryRankingsCaption: "Classement complet des dépôts GitHub {label}",
    gainedCaption: "Dépôts GitHub {label} par étoiles gagnées",
    growthCaption: "Dépôts GitHub {label} par taux de croissance",
    crossedCaption: "Dépôts GitHub ayant franchi 10k étoiles pendant {label}",
    categorySummaryCaption: "Catégories publiques de dépôts GitHub",
    categoryDimensionSummaryCaption: "Catégories de dépôts GitHub {label}",
    categoryDetailCaption: "Dépôts {label} par étoiles actuelles",
    categoryPagination: "Pagination {label}",
    range: "{first}-{last} sur {total}",
    rankingDatasetName: "Jeu de données de classement GitStarClub {label}",
    rankingDatasetDescription: "Classements de dépôts GitHub {label} générés depuis les données de classement précalculées de GitStarClub lorsqu'elles sont disponibles.",
    rankingCollectionName: "Classements de dépôts GitHub {label}",
    rankingItemListName: "Classements de dépôts GitHub {label}",
    rankingMetricGained: "étoiles gagnées pendant la période sélectionnée",
    rankingMetricTotal: "étoiles totales actuelles",
    rankingLeader: "{repo} mène avec {value}",
    rankingFollowers: ", suivi de {second} et {third}",
    rankingEmpty: "la liste visible attend des lignes de classement",
    rankingCapsule:
      "Au {asOf}, {title} classe les dépôts GitHub suivis par {metric}. {leader}{followers}. GitStarClub génère ce classement visible depuis des données de classement et de dépôts précalculées, sans recherche, base de données ni IA à l'exécution.",
    rankingWhatQ: "Que classe {title} ?",
    rankingWhatAWithAsOf: "Au {asOf}, {title} classe les dépôts GitHub suivis par {metric}.",
    rankingWhatANoAsOf: "GitStarClub classe dans {title} les dépôts GitHub suivis par {metric} depuis des données de classement précalculées.",
    rankingLeaderQ: "Quel dépôt mène {title} ?",
    rankingLeaderA: "{repo} mène {title} avec {value}.",
    rankingLeaderFallbackA: "La liste visible de {title} attend des lignes de classement.",
    rankingRunnerQ: "Qui suit {repo} dans {title} ?",
    rankingRunnerFallbackQ: "{title} inclut-il des dépôts suivants ?",
    rankingRunnerA: "{repo} apparaît ensuite dans le classement visible avec {value}.",
    rankingRunnerFallbackA: "Les lignes suivantes apparaissent lorsque le classement précalculé contient au moins deux dépôts.",
    rankingDataQ: "{title} utilise-t-il des requêtes de base de données en direct ?",
    rankingDataA: "Non. GitStarClub rend {title} depuis des données de classement et de dépôts précalculées.",
    categoryIndexDatasetName: "Jeu de données du registre de catégories GitStarClub",
    categoryIndexDatasetDescription: "Parcourez les catégories publiques de dépôts GitHub par langage, écosystème, domaine, type de projet, type de propriétaire, maturité, et plus.",
    categoryIndexCollectionName: "Catégories de dépôts GitHub",
    categoryIndexItemListName: "Catégories de dépôts GitHub",
    categoryIndexCapsule:
      "Au {asOf}, GitStarClub organise les dépôts GitHub suivis en {categories} catégories publiques sur {dimensions} dimensions, dont {labels}. Les liens de catégorie viennent de règles déterministes sur les métadonnées de dépôts, pas d'une recherche en direct ni d'une IA.",
    categoryIndexQ: "Que sont les catégories de dépôts GitHub sur GitStarClub ?",
    categoryIndexAWithAsOf: "Au {asOf}, GitStarClub organise les dépôts suivis en {categories} catégories publiques sur {dimensions} dimensions.",
    categoryIndexANoAsOf: "GitStarClub organise les dépôts suivis en {categories} catégories publiques sur {dimensions} dimensions.",
    categoryDimensionsQ: "Quelles dimensions de catégorie sont disponibles ?",
    categoryDimensionsA: "Les dimensions visibles sont {labels}.",
    categoryCountsQ: "D'où viennent les comptes de catégories ?",
    categoryCountsA: "Les comptes viennent des données de catégories propres à GitStarClub : des règles déterministes sur les métadonnées de dépôts, pas d'une recherche en direct ni d'une IA.",
    categoryMoveQ: "Comment passer des catégories aux dépôts ?",
    categoryMoveAWithDimension: "Les lecteurs peuvent ouvrir une dimension comme {label}, puis suivre un lien de catégorie vers une liste de dépôts classés.",
    categoryMoveAFallback: "Les lecteurs peuvent ouvrir n'importe quelle dimension visible, puis suivre un lien de catégorie vers une liste de dépôts classés.",
    categoryDimensionDatasetName: "Jeu de données de catégories GitStarClub {label}",
    categoryDimensionDatasetDescription: "Parcourez les définitions, comptes et liens explorables {label} pour les dépôts GitHub suivis.",
    categoryDimensionCollectionName: "Catégories {label}",
    categoryDimensionItemListName: "Catégories {label}",
    categoryDimensionCapsule:
      "Au {asOf}, GitStarClub liste {categories} catégories publiques dans la dimension {label} pour les dépôts GitHub suivis. Cette page utilise des règles déterministes sur les métadonnées de dépôts, pas une recherche en direct ni une IA, avec des liens explorables vers des classements précis.",
    categoryDimensionQ: "Que contient la page de catégorie {label} ?",
    categoryDimensionAWithAsOf: "Au {asOf}, la page {label} liste {categories} catégories publiques pour les dépôts GitHub suivis.",
    categoryDimensionANoAsOf: "La page {label} liste {categories} catégories publiques pour les dépôts GitHub suivis.",
    categoryLargestQ: "Quelle catégorie {label} contient le plus de dépôts suivis ?",
    categoryLargestA: "{category} est la plus grande catégorie visible {label} avec {count} dépôts suivis.",
    categoryLargestFallbackA: "Aucun compte public de catégorie {label} n'est encore disponible.",
    categoryLinksQ: "Comment les liens de catégorie {label} sont-ils générés ?",
    categoryLinksA: "GitStarClub rend les liens {label} depuis le registre de catégories, avec les flags publics, slugs, labels et comptes précalculés avant la requête.",
    categoryNoClientQ: "La page {label} exécute-t-elle un filtrage côté client ?",
    categoryNoClientA: "Non. La page {label} est rendue côté serveur et n'ajoute pas de filtrage client pour la FAQ visible ou les liens de catégorie.",
    categoryDetailDatasetName: "Jeu de données de dépôts GitStarClub {label}",
    categoryDetailDatasetDescription: "Classements de dépôts {label} générés depuis des affectations de catégorie déterministes, des données de classement historique et des champs de dépôts.",
    categoryDetailCollectionName: "Dépôts {label}",
    categoryDetailItemListName: "Dépôts {label}",
    categoryDetailCapsule:
      "Au {asOf}, GitStarClub suit {count} dépôts dans {label}. {leader}{followers}. Ce classement de catégorie utilise des affectations de catégorie déterministes, des données de classement historique et des champs de dépôts.",
    categoryDetailQ: "Quels dépôts sont inclus dans {label} ?",
    categoryDetailAWithAsOf: "Au {asOf}, {label} inclut {count} dépôts suivis selon le registre de catégories.",
    categoryDetailANoAsOf: "{label} inclut {count} dépôts suivis selon le registre de catégories chargé.",
    categoryDetailLeaderQ: "Quel dépôt mène {label} ?",
    categoryDetailLeaderA: "{repo} mène {label} avec {value}.",
    categoryDetailLeaderFallbackA: "Le classement {label} attend des lignes de classement de catégorie.",
    categoryDetailRunnerQ: "Quel dépôt suit {repo} dans {label} ?",
    categoryDetailRunnerFallbackQ: "{label} affiche-t-il des dépôts suivants ?",
    categoryDetailRunnerA: "{repo} suit dans {label} avec {value}.",
    categoryDetailRunnerFallbackA: "Les dépôts suivants apparaissent lorsque des lignes de classement de catégorie sont disponibles.",
    categoryDetailDataQ: "Comment le classement {label} est-il généré ?",
    categoryDetailDataA: "GitStarClub combine des affectations de catégorie déterministes, des données de classement historique et des champs de dépôts. La page n'appelle ni recherche en direct ni IA.",
    totalStarsValue: "{value} étoiles totales",
    gainedStarsValue: "{value} étoiles",
  },
};

export function detailText(locale: Locale): DetailText {
  return TEXT[locale];
}

export function answerCapsuleLabels(locale: Locale, t: Dict): AnswerCapsuleLabels {
  return {
    ariaLabel: t.common.answerCapsule,
    eyebrow: t.common.answerCapsule,
    dataAsOf: t.common.dataAsOf,
    source: t.common.source,
  };
}

export function categoryTableLabels(locale: Locale, t: Dict): CategorySummaryTableLabels {
  return {
    caption: t.categories.title,
    category: t.categories.eyebrow,
    dimension: t.categories.dimensionEyebrow,
    slug: t.tables.slug,
    trackedRepositories: t.categories.trackedRepositories,
    gitstarclubUrl: t.tables.gitstarclubUrl,
    pendingCount: t.categories.pendingCount,
  };
}

export function shareButtonLabels(locale: Locale, t: Dict) {
  return {
    label: t.share.label,
    copied: t.share.copied,
    onX: t.share.onX,
    opensNewTab: t.share.opensNewTab,
  };
}

export function shareableSnippetLabels(t: Dict): ShareableSnippetLabels {
  return {
    eyebrow: t.share.snippet,
    copy: t.share.copy,
    copied: t.share.copied,
    embed: t.share.embed,
    embedCopied: t.share.embedCopied,
  };
}

export function paginationLabels(t: Dict): { previous: string; next: string } {
  return { previous: t.common.previous, next: t.common.next };
}

export function buildLocalizedRankingCapsule({
  locale,
  title,
  asOf,
  rows,
  metric,
}: {
  locale: Locale;
  title: string;
  asOf: string;
  rows: readonly CapsuleRankRow[];
  metric: RankingMetric;
}): AnswerCapsuleContent {
  const text = detailText(locale);
  const [first, second, third] = rows;
  const leader = first ? fill(text.rankingLeader, rankValues(first, locale, metric)) : text.rankingEmpty;
  const followers = second && third ? fill(text.rankingFollowers, { second: repoName(second), third: repoName(third) }) : "";
  return capsule(locale, fill(text.rankingCapsule, { asOf, title, metric: rankingMetricLabel(locale, metric), leader, followers }), asOf);
}

export function buildLocalizedRankingFaqs({
  locale,
  title,
  asOf,
  rows,
  metric,
}: {
  locale: Locale;
  title: string;
  asOf: string | null;
  rows: readonly CapsuleRankRow[];
  metric: RankingMetric;
}): FaqItem[] {
  const text = detailText(locale);
  const leader = rows[0];
  const second = rows[1];
  return [
    {
      question: fill(text.rankingWhatQ, { title }),
      answer: asOf
        ? fill(text.rankingWhatAWithAsOf, { asOf, title, metric: rankingMetricLabel(locale, metric) })
        : fill(text.rankingWhatANoAsOf, { title, metric: rankingMetricLabel(locale, metric) }),
    },
    {
      question: fill(text.rankingLeaderQ, { title }),
      answer: leader ? fill(text.rankingLeaderA, { title, ...rankValues(leader, locale, metric) }) : fill(text.rankingLeaderFallbackA, { title }),
    },
    {
      question: second
        ? fill(text.rankingRunnerQ, { title, repo: repoName(leader ?? second) })
        : fill(text.rankingRunnerFallbackQ, { title }),
      answer: second ? fill(text.rankingRunnerA, rankValues(second, locale, metric)) : text.rankingRunnerFallbackA,
    },
    {
      question: fill(text.rankingDataQ, { title }),
      answer: fill(text.rankingDataA, { title }),
    },
  ];
}

export function buildLocalizedCategoryIndexCapsule(locale: Locale, registry: CategoryRegistry, asOf: string): AnswerCapsuleContent {
  const text = detailText(locale);
  const publicCategories = registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
  const labels = listLabels(
    registry.dimensions.slice(0, 3).map((dimension) => dimension.label),
    locale,
  );
  return capsule(
    locale,
    fill(text.categoryIndexCapsule, {
      asOf,
      categories: count(locale, publicCategories.length),
      dimensions: count(locale, registry.dimensions.length),
      labels,
    }),
    asOf,
  );
}

export function buildLocalizedCategoryIndexFaqs(locale: Locale, registry: CategoryRegistry, asOf: string | null): FaqItem[] {
  const text = detailText(locale);
  const publicCategories = registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
  const firstDimension = registry.dimensions[0];
  const values = {
    categories: count(locale, publicCategories.length),
    dimensions: count(locale, registry.dimensions.length),
    labels: listLabels(registry.dimensions.map((dimension) => dimension.label), locale),
  };
  return [
    {
      question: text.categoryIndexQ,
      answer: asOf ? fill(text.categoryIndexAWithAsOf, { asOf, ...values }) : fill(text.categoryIndexANoAsOf, values),
    },
    { question: text.categoryDimensionsQ, answer: fill(text.categoryDimensionsA, values) },
    { question: text.categoryCountsQ, answer: text.categoryCountsA },
    {
      question: text.categoryMoveQ,
      answer: firstDimension ? fill(text.categoryMoveAWithDimension, { label: firstDimension.label }) : text.categoryMoveAFallback,
    },
  ];
}

export function buildLocalizedCategoryDimensionCapsule(locale: Locale, dimension: CategoryDimensionRegistry, asOf: string): AnswerCapsuleContent {
  const text = detailText(locale);
  const publicCategories = dimension.categories.filter((category) => category.public);
  return capsule(
    locale,
    fill(text.categoryDimensionCapsule, {
      asOf,
      label: dimension.label,
      categories: count(locale, publicCategories.length),
    }),
    asOf,
  );
}

export function buildLocalizedCategoryDimensionFaqs(locale: Locale, dimension: CategoryDimensionRegistry, asOf: string | null): FaqItem[] {
  const text = detailText(locale);
  const publicCategories = dimension.categories.filter((category) => category.public);
  const largest = [...publicCategories].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
  const values = { label: dimension.label, categories: count(locale, publicCategories.length) };
  return [
    {
      question: fill(text.categoryDimensionQ, { label: dimension.label }),
      answer: asOf ? fill(text.categoryDimensionAWithAsOf, { asOf, ...values }) : fill(text.categoryDimensionANoAsOf, values),
    },
    {
      question: fill(text.categoryLargestQ, { label: dimension.label }),
      answer: largest
        ? fill(text.categoryLargestA, { label: dimension.label, category: largest.label, count: count(locale, largest.count) })
        : fill(text.categoryLargestFallbackA, { label: dimension.label }),
    },
    {
      question: fill(text.categoryLinksQ, { label: dimension.label }),
      answer: fill(text.categoryLinksA, { label: dimension.label }),
    },
    {
      question: fill(text.categoryNoClientQ, { label: dimension.label }),
      answer: fill(text.categoryNoClientA, { label: dimension.label }),
    },
  ];
}

export function buildLocalizedCategoryDetailCapsule({
  locale,
  category,
  asOf,
  rows,
}: {
  locale: Locale;
  category: CategoryRegistryEntry;
  asOf: string;
  rows: readonly CapsuleRankRow[];
}): AnswerCapsuleContent {
  const text = detailText(locale);
  const [first, second, third] = rows;
  const leader = first ? fill(text.rankingLeader, rankValues(first, locale, "total")) : fill(text.categoryDetailLeaderFallbackA, { label: category.label });
  const followers = second && third ? fill(text.rankingFollowers, { second: repoName(second), third: repoName(third) }) : "";
  return capsule(
    locale,
    fill(text.categoryDetailCapsule, {
      asOf,
      label: category.label,
      count: count(locale, category.count),
      leader,
      followers,
    }),
    asOf,
  );
}

export function buildLocalizedCategoryDetailFaqs({
  locale,
  category,
  asOf,
  rows,
}: {
  locale: Locale;
  category: CategoryRegistryEntry;
  asOf: string | null;
  rows: readonly CapsuleRankRow[];
}): FaqItem[] {
  const text = detailText(locale);
  const leader = rows[0];
  const second = rows[1];
  return [
    {
      question: fill(text.categoryDetailQ, { label: category.label }),
      answer: asOf
        ? fill(text.categoryDetailAWithAsOf, { asOf, label: category.label, count: count(locale, category.count) })
        : fill(text.categoryDetailANoAsOf, { label: category.label, count: count(locale, category.count) }),
    },
    {
      question: fill(text.categoryDetailLeaderQ, { label: category.label }),
      answer: leader
        ? fill(text.categoryDetailLeaderA, { label: category.label, ...rankValues(leader, locale, "total") })
        : fill(text.categoryDetailLeaderFallbackA, { label: category.label }),
    },
    {
      question: second
        ? fill(text.categoryDetailRunnerQ, { label: category.label, repo: repoName(leader ?? second) })
        : fill(text.categoryDetailRunnerFallbackQ, { label: category.label }),
      answer: second
        ? fill(text.categoryDetailRunnerA, { label: category.label, ...rankValues(second, locale, "total") })
        : text.categoryDetailRunnerFallbackA,
    },
    {
      question: fill(text.categoryDetailDataQ, { label: category.label }),
      answer: text.categoryDetailDataA,
    },
  ];
}

function capsule(locale: Locale, text: string, asOf: string): AnswerCapsuleContent {
  return { text: `${text}${detailText(locale).sourceSuffix}`, asOf, source: ANSWER_CAPSULE_SOURCE };
}

function rankingMetricLabel(locale: Locale, metric: RankingMetric): string {
  const text = detailText(locale);
  return metric === "total" ? text.rankingMetricTotal : text.rankingMetricGained;
}

function rankValues(row: CapsuleRankRow, locale: Locale, metric: RankingMetric): Record<string, string> {
  return {
    repo: repoName(row),
    value: metric === "total" ? fill(detailText(locale).totalStarsValue, { value: fmtStars(row.total ?? 0) }) : fill(detailText(locale).gainedStarsValue, { value: signedStars(row.gained ?? 0) }),
  };
}

function repoName(row: CapsuleRankRow): string {
  return `${row.owner}/${row.name}`;
}

function signedStars(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value))}`;
}

function count(locale: Locale, value: number): string {
  return formatInteger(locale, value);
}

function listLabels(values: readonly string[], locale: Locale): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  const separator = locale === "ja" || locale === "zh" || locale === "zh-TW" ? "、" : locale === "es" ? " y " : locale === "fr" ? " et " : " and ";
  if (values.length === 2) return `${values[0]}${separator}${values[1]}`;
  const last = values.at(-1) ?? "";
  const head = values.slice(0, -1);
  if (locale === "ja" || locale === "zh" || locale === "zh-TW") return `${head.join("、")}、${last}`;
  return `${head.join(", ")}${separator}${last}`;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
