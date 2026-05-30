import type { Dict } from "./en";

// 中文 UI chrome。数据（仓库名、语言、主题、数字）一律不翻译。
const zh: Dict = {
  nav: { trending: "脉搏", rankings: "总榜", about: "关于" },
  home: {
    lead: "十一年势能，一览无余。选一个年份进入它的篇章。",
    thisMonth: "本月至今",
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
};

export default zh;
