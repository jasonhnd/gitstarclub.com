# gitstarclub 产品设计

> 本文档定义产品的页面、信息架构、URL 与视觉调性。架构与数据层见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## Scope

本文档描述**产品本身**——gitstarclub 是什么、给谁看、各页面承载什么、调性、数据诚实立场、i18n 立场。改动产品前先读此文。版本/阶段/状态属于工程进度,不在此处。当前不在范围内的能力见 [ROADMAP.md](./ROADMAP.md)。

## 产品定位

gitstarclub 是 **开源世界的编年史 + 实时脉搏** —— 追踪约 5,261 个 ≥10k star 项目跨 12 年时间轴的两面式站点:

- **编年史面**(年/月/周/repo/org/全时榜):回看历史,内容多为冻结快照,标注 "as of 日期"。
- **脉搏面**(`/pulse` + 首页"现在在涨"区):每日刷新,呈现谁在涨、老项目复活/突刺。

**目标用户**:对开源生态有兴趣的开发者、技术媒体、研究者——想"按时间翻阅"或"看当下动态"而不是只查单个 repo 的人。

**数据诚实**:站点不杜撰、不预测、不情感化。每张图、每个排名都基于明确的口径(见 [RANKING.md](./RANKING.md))。冻结期标快照日期,活跃期标"每日刷新"。

## 调性

**Material 3 Expressive（M3E）** —— 2025 / Android 17 的设计语言：鲜明动态的色彩、富表现力的字体层级、圆润形状、弹簧动效、tonal elevation 与毛玻璃质感。

差异化不再靠"纸感"，而靠 **冷石墨灰中性底 + 金"星"accent + 表现力动效**：金色专属"星 / 峰值"语义，surface 走冷中性石墨灰（明确避开暖米色——那是 Claude 官网的观感）。在一众暗色极客 dashboard 里仍一眼不同，且 premium。明暗双模式（系统偏好 + 手动切换）。

### 字体

| 用途 | 字体 |
|---|---|
| 标题 / 正文 | **Plus Jakarta Sans**（几何变量无衬线） |
| 数字 / repo 名 | **Geist Mono** |

- 标题走 M3 Display/Headline：大字号 + 重字重（700–800）、负字距，体现 M3E"强层级、即时感"
- 正文同一家族 400/500；全站最多两个家族（无衬线 + 等宽），符合性能预算

### 配色（accent = 琥珀金 `#F2A900`；surface = 冷中性石墨灰）

**金色仅作 accent（"星"色）**：primary / primary-container / primary-fixed-dim 由琥珀金 seed 经 `material-color-utilities` 生成。**surface 与 Claude 暖米色脱钩**——改用 M3 baseline 冷中性灰（带极轻冷调），不随金 seed 染成暖色。完整 sys color roles（含 5 级 surface-container、fixed 角色、明暗两套）。

> 注：M3 里 `primary`（tone 40）是**深色**文字角色，**亮琥珀在 `primary-container`**；"亮金"装饰（星、峰值）用 `primary-fixed-dim`；surface / outline / inverse 用 M3 baseline 冷中性灰（与 seed 解耦，避免暖色染色 → 不撞 Claude）。
> **完整调色板（角色 × Light/Dark × 用途，明暗两套全角色）见 [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)。**

### 质感

- **tonal elevation**：用 `surface-container` 的 5 个层级 + M3 阴影表达高度（取代旧"只用 hairline、不用阴影"）
- **圆润形状**：M3 shape scale（4 / 8 / 12 / 16 / 28 / full），pill 与 squircle
- **毛玻璃**：顶栏 / 浮层用 `backdrop-filter` 半透明（M3E 标志质感）
- **弹簧动效**：CSS `linear()` 编码弹簧曲线 + `cubic-bezier(0.2,0,0,1)` emphasized 缓动；**内容页仍零客户端 JS**，动效纯 CSS；跨文档 **View Transitions** 做容器形变页面转场
- 尊重 `prefers-reduced-motion`

> 放弃纸感 / 衬线、放弃暖米色（避开 Claude 观感）。M3 Expressive：**石墨灰 + 星金**、鲜明动态 premium、明暗双模式。

## URL 结构

> 下表给**用途 ↔ URL**；权威路由↔文件↔渲染层清单见 [FRONTEND.md](./FRONTEND.md) §1.1。

| 用途 | URL |
|---|---|
| 首页 | `/` |
| 年度页 | `/rankings/2024` |
| 月度页 | `/rankings/2024/10` |
| **周页** | `/rankings/2024/W42`（独立页，ISO 周） |
| Repo 详情页 | `/:owner/:name` |
| **Org 详情页** | `/o/:login` |
| **全时榜** | `/rankings` |
| **脉搏页** | `/pulse`（今日/本周大涨 + 复活/突刺） |
| 关于页 | `/about` |

原则：**最短、可读、SEO 友好**。**URL 语言中立、无语言段**（语言走页内 `gsc_lang` cookie，见下「多语言」与 [SEO.md](./SEO.md) §10）。

## 核心页面（编年史 + 脉搏两面）

> **编年史面**：首页/年/月/周/repo/org/全时榜——回看，多为冻结 / 标 "as of 日期"。**脉搏面**：`/pulse` + 首页"现在在涨"区——每日刷新"谁在涨/老项目复活"（新鲜度模型见 [REQUIREMENTS §6](./REQUIREMENTS.md)）。

### 1. 首页 `/`

**目标**：一眼传达"整个开源世界的时间脉络"，让访客点进任意一年/月。

**布局（从上到下）**：

1. 标题与一句话（"开源世界的编年史 · 约 5,261 个 ≥10k star 项目 · 12 年时间轴"）
2. **年份脊柱**：2015 → 当前年，每行一年
   - 每行 = bar（宽度 = 全年新增 star）+ 全年星数 + **一句年度标签**
   - 年度标签：人工手写 12 条（每年一条，如 "2024 · AI 元年 · claude-code, ollama 崛起"）
   - 点击：进入年度页 `/rankings/2024`
3. **本月聚焦**：当月 TOP / 当月增速，左右并列
4. **历史上的今天**：3-5 条
   - 实现：取 `crossed_10k` 命中今天"月-日"的 repo，按当时 star 量排序

### 2. 年度页 `/rankings/2024`

**目标**：在年的尺度回顾"那一年开源世界的脉络"。

**布局**：

1. 年度标题
2. **12 个月份格子**（热力图风格，3×4 或 1×12）
   - 颜色深度 = 当月新增 star 量
   - 点击进入月度页
3. 年度 TOP 50 榜单
4. 年度新晋成员（首次突破 10k 的 repo）
5. 上下年导航 `← 2023 | 2025 →`

### 3. 月度页 `/rankings/2024/10`

**目标**：在一页内看完"那个月开源世界发生了什么"。

**布局**：

1. 标题 + 上下月导航（永远在顶部）
2. 一句话总结（"这个月：约 5,261 个项目共新增 2.3M star · 47 个新晋成员"）
3. **当月日历热力图**（31 天，看出有无爆发日）
4. **榜单（repo 与 org 并列）**：
   - 🔥 **当月新增 TOP**（flow）· **当月总量 TOP**（stock）— repo 维度
   - 🏢 **当月 org 榜**（flow / stock）— 组织维度（点 org → `/o/:login`）
   - 🚀 **当月增速 TOP**（flow ÷ 月初 stock，floor ≥ 20k）
   - 🎂 **本月新晋**（stock 首破 10k）
5. **上下月对比**：进入/跌出 TOP 50 的项目
6. 内部链接：榜单里每个 repo → repo 详情页

### 4. Repo 详情页 `/:owner/:name`

**目标**：完整看一个项目的"一生"。

**布局**：

1. 标题：`owner / name` + 一句话描述 + 当前 star
2. 元信息条：语言、创建时间、上次同步时间
3. **全历史 star 曲线**，标注关键里程碑
4. **关键里程碑列表**：创建、首次进榜、突破 10k/50k/100k、当前
   - 每个里程碑 → 链接到对应月度页
5. **月度表现表格**：近 N 月 新增 star + 当月排名
   - 月份列每行都是链接到月度页
6. 元信息：topics、GitHub 外链

### 5. 周页 `/rankings/2024/W42`（独立）

- 那一周的 repo / org 涨幅 TOP + 站点周总量；上下周导航（ISO 周）。
- 当周为"活"页（每日刷新），过去周冻结。

### 6. Org 详情页 `/o/:login`

- org 合计 star 曲线（成员聚合）+ 当前总数（as-of）。
- 成员 repo 列表（各自 star）+ org 在各周期的名次史。
- User 与 Organization 都有页。

### 7. 全时榜 `/rankings`

- 当前总量 TOP：**repo 榜 + org 榜**（stock 降序）。"谁最大"的总览，每日刷新。

### 8. 脉搏页 `/pulse`（此刻在涨）

- 今日 / 本周 **涨幅 TOP** + **复活/突刺**（老项目突然爆）。
- 每日刷新，是"最新动态"的落点（判定口径见 [REQUIREMENTS §6](./REQUIREMENTS.md)）。

### 发现入口：全站搜索

- **导航栏搜索框**（顶栏 chrome），覆盖全部约 5,261 个被追踪 repo——「按名字直达」的发现入口，与「按时间浏览」（年/月/周）互补。
- **客户端即时检索**：MiniSearch 在首次聚焦时懒加载版本化 `search/index.json`（经 CDN）；prefix + fuzzy typo 容错、按 stars 加权；结果直达 `/{owner}/{name}`。**零运行时后端**——无 `/search?q=` 结果页。

## 排名矩阵与榜单定义

> 全矩阵 **{周/月/年/全时} × {repo/org} × {flow 新增 / stock 总量}**——定义、stock 锚定、边界见 [RANKING.md](./RANKING.md)。下面是页面上常用的派生榜：

| 榜单 | 定义 | 偏向 |
|---|---|---|
| 当月新增 star TOP | 当月 flow（∑delta）降序 | 已成名大项目 |
| 当月增速 TOP | `当月新增 / 月初总数` 降序，**月初总数 ≥ 20,000** 才入选 | 已有体量却仍在加速的中坚 |
| 本月新晋 | 当月累计（stock）首次 ≥ 10000 | 新血液 |

> 增速榜 floor（月初 ≥ 20k）的理由、排重规则（新晋不进增速）等口径见 [RANKING.md](./RANKING.md) §4。

## Repo 身份与改名

- 主键用 GitHub repo **id**（不可变）；URL 用当前 `owner/name`
- repo 改名/迁移：每周白名单刷新时被动更新 `full_name`，旧 URL 做 **301** 重定向
- MVP 不主动追踪完整改名历史（量小，不值得投入）

## 多语言（i18n）

调性：默认英文，优先级 **英文 > 日文 > 中文 >** zh-TW / ko / es / fr 七种 UI 语言；语言是页内 cookie 偏好（`gsc_lang`），不进 URL、不发 hreflang，仅翻译 chrome、不碰数据字段。**权威口径见 [SEO.md](./SEO.md) §10，实现见 [FRONTEND.md](./FRONTEND.md) §7（option C）。**

## 项目命名

项目名 **gitstarclub**，域名 **gitstarclub.com**（已购）。

## 视觉/交互细节

- **永远显示上下月/年导航** —— 强化"翻阅"感
- **榜单内的 repo 名 = 内部链接**；星数变化 = 视觉权重；语言 = 弱标签
- **里程碑链接** = 月度页锚点，形成网状内部循环
- **时间点双显示 UTC + JST**（JA locale 以 JST 为主）；日期粒度数据按 UTC 日
- **全站搜索**：见上「发现入口：全站搜索」。

## 范围之外

当前不在范围内的能力（多 repo 对比、用户系统、数据集扩展、自动叙事/OG 卡片、主题聚类等）见 [ROADMAP.md](./ROADMAP.md)。
