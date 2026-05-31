import type { Dict } from "./en";

// 中文 UI chrome。数据（仓库名、语言、主题、数字）一律不翻译。
const zh: Dict = {
  nav: { trending: "脉搏", rankings: "总榜", about: "关于" },
  home: {
    heroPre: "",
    heroAccent: "开源",
    heroPost: "的编年史。",
    lead: "十一年势能，一览无余。选一个年份进入它的篇章。",
    thisMonth: "本月至今",
    perYear: "各年新增星标",
    gainedAria: "新增星标",
  },
  about: {
    heroPre: "一份诚实的",
    heroAccent: "编年史",
    heroPost: "。",
    lead: "gitstarclub 收录每一个公开的、星标超过 1 万的仓库，并自 2015 年起按月、按年重建它们各自的崛起轨迹。",
    s1h: "数据从哪来",
    s1pPre: "历史由 ",
    s1pPost:
      "（2015 年以来所有公开的 GitHub 事件）重建而成。当前总数来自官方 GitHub GraphQL 与 Search API。我们只展示公开仓库的公开数据。",
    s2h: "诚实的局限",
    s2aStrong: "两把尺子。",
    s2aBody:
      " 历史曲线统计的是新增的总（gross）星标（GH Archive 的 watch 事件）；而每日实时增量是净（net）值，取消星标时会下降。两者的接缝略有不一致——star-history.com 也有同样的局限。当前总数始终以 GitHub 的权威计数为准。",
    s2bStrong: "幸存者偏差。",
    s2bBody: " 我们只回填今天星标 ≥1 万的仓库。那些曾经崛起又消退的项目不在历史里。",
    s2cStrong: "为什么从 2015 年？",
    s2cBody:
      " 2012 年底之前，GitHub 的「watch」与 star 并不等同；数据在 2015 年趋于稳定，我们以此作为现代开源时代的起点。",
    s3h: "时间",
    s3p: "一切以 UTC 存储、按 UTC 日界聚合。凡显示具体时刻处，UTC 与 JST（日本时间）并列——gitstarclub 在东京制作。",
    back: "返回编年史",
  },
  year: {
    label: "年份",
    all: "所有年份",
    spine: "脊柱",
    top: "年度涨星榜",
    gained: "新增星标（追踪范围内）",
    ledBy: "领涨",
  },
  month: {
    label: "月份",
    most: "涨星最多",
    mostSub: "绝对新增最多",
    fastest: "增速最快",
    fastestSub: "增速榜・2 万星门槛",
    newcomers: "新晋",
    newcomersSub: "首破 1 万星",
    daily: "每日势能",
    gained: "追踪范围内新增",
    newcomersWord: "个新晋",
  },
  week: { label: "周", top: "本周涨星榜" },
  repo: {
    history: "星标历史",
    milestones: "里程碑",
    recent: "近月新增",
    created: "创建于",
    archived: "已归档",
    github: "在 GitHub 查看",
    rank: "第",
  },
  org: {
    history: "合计星标历史",
    repos: "追踪的仓库",
    total: "合计",
    trackedRepos: "个追踪仓库",
    organization: "Organization",
    developer: "User",
  },
  rankings: {
    title: "历史总榜",
    subtitle: "按当前星标数排列的最大仓库与组织。",
    repositories: "仓库",
    organizations: "组织",
    repos: "个仓库",
  },
  trending: {
    title: "脉搏",
    subtitle: "此刻开源世界正在大涨的项目。",
    surging: "本月大涨",
    onThisDay: "历史上的今天",
    crossed: "突破",
  },
  footer: {
    madeIn: "于东京打造",
    dataThrough: "数据截至",
  },
};

export default zh;
