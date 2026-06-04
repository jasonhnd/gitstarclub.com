# gitstarclub 设计系统

> 本文档是视觉与交互的**唯一真相源**：色彩 / 字体 / 形状 / 动效 / 高度 / 无障碍 / 组件清单 / 零客户端 JS 约束。
> 调性与页面见 [PRODUCT.md](./PRODUCT.md)，架构与渲染见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 落地实现：teaser `src/index.html`（内联 token）与 web 应用 `web/app/globals.css`（`@theme` 接 Tailwind 4），二者 token 值一致。

## Scope

本文档描述设计系统：token（色彩 / 形状 / 动效 / 高度）、字体与排版、组件清单、动效规则、无障碍规则，以及零客户端 JS 约束与其具名例外。在新增任何 UI 表面或修改任何 token 之前先读本文档。

## 设计方向与原则

**Material 3 Expressive（M3E）**——鲜明动态色彩、强字体层级、圆润形状、弹簧动效、tonal elevation、毛玻璃。差异化靠 **冷石墨灰中性底 + 金"星"accent + 表现力动效**，明确避开暖米色（Claude 官网观感）。

核心原则（按优先级）：

1. **零客户端 JS 优先**：内容页正文动效纯 CSS、图表服务端渲染 SVG。客户端 JS 仅限末节列出的**四处例外**（防闪烁脚本 / 主题切换 / PWA SW 注册 / `/compare` 对比工具页）。
2. **token 驱动**：颜色 / 形状 / 动效 / 高度全走 CSS 自定义属性；组件不写死调色板、字号、间距。
3. **冷底暖点**：surface 冷中性石墨灰；金色专属"星 / 峰值 / 名次"语义，克制使用。
4. **强层级、即时感**：大字号 + 重字重标题，tonal + 阴影双轨表达高度，emphasized 缓动收尾。
5. **明暗双模式平权**：两套都要刻意打磨，非"暗色加个亮色变体"。
6. **性能即设计**：两个字体家族、子集化、compositor-friendly 动效、`prefers-reduced-motion` 全程兜底。

**组件策略（已决）**：**手写 M3E token + Tailwind 4 + 语义化 HTML/CSS**，不引入 `@material/web`。理由：`@material/web` 处于维护模式、不含 Material 3 Expressive、且是 Lit/JS 组件——违反内容页零客户端 JS。M3E 的观感由 token + 少量 CSS primitive（`.hl`、`.spine-bar`、`.curve-line` 等）表达，组件用 RSC + Tailwind 工具类拼装。

## 色彩系统

### Token 角色（M3 sys color roles）

完整 M3 角色，明暗两套，含 5 级 surface-container 与 fixed 角色。关键角色与语义：

| 角色 | Light | Dark | 用途 |
|---|---|---|---|
| `primary` | `#7f5700` | `#ffca74` | 文字 / 图标 / 曲线主线（M3 里 tone 40 是**深色文字角色**） |
| `on-primary` | `#ffffff` | `#432c00` | primary 填充上的前景 |
| `primary-container` | `#f2a900` | `#f2a900` | **品牌琥珀**：高亮面、`.hl` 背景、年份脊柱条、曲线渐变 |
| `on-primary-container` | `#614200` | `#614200` | 琥珀面上的前景 |
| `primary-fixed-dim` | `#ffba3b` | `#ffba3b` | **跨主题一致的亮金**：★、峰值条、名次数字、热力图峰值、里程碑点 |
| `on-primary-fixed` | `#281900` | `#281900` | 亮金面上的前景 |
| `secondary-container` | `#ffd391` | `#5e420c` | 次级强调面 |
| `tertiary` | `#00668a` | `#9edaff` | 青色互补：链接、状态 chip |
| `tertiary-container` | `#3fc3ff` | `#3fc3ff` | 青色强调面 |
| `on-tertiary-container` | `#004e6b` | `#004e6b` | 青色面前景 |
| `background` / `surface` | `#fbfbfd` | `#121316` | **冷石墨灰中性底**（极轻冷调，非暖米 / 暖棕） |
| `on-surface` | `#1a1c1e` | `#e3e2e6` | 主要前景文字 |
| `on-surface-variant` | `#43474e` | `#c3c7cf` | 次要文字、弱标签、轴标 |
| `surface-variant` | `#dfe2eb` | `#43474e` | 弱填充面 |
| `surface-container-lowest→highest` | 5 级（`#ffffff`→`#e3e3e7`） | 5 级（`#0d0e11`→`#333538`） | **tonal elevation 层级**（冷中性灰） |
| `outline` / `outline-variant` | `#73777f` / `#c3c7cf` | `#8d9199` / `#43474e` | 分隔线、描边、ring |
| `inverse-surface` / `inverse-on-surface` | `#2f3033` / `#f1f0f4` | `#e3e2e6` / `#2f3033` | 反色面（toast / 选区） |

辅助 token：`--md-shadow-rgb: 0 0 0`（阴影基色，供 elevation 用）。

### 冷底 + 金点的理由与做法

**问题**：用 `material-color-utilities` 从单一暖琥珀 seed 跑标准方案，会把 surface / outline / neutral 全部染成暖米暖棕——正是要避开的 Claude 观感。

**做法（surface 与 seed 解耦）**：

- **accent 角色**（`primary` / `primary-container` / `primary-fixed-dim` / `on-primary*` / `secondary*`）→ 由琥珀 seed `#F2A900` 生成，保留品牌金。
- **surface / background / outline / surface-variant / inverse / neutral 系**→ **不取暖 seed 的中性色**，改用 M3 baseline **冷中性灰**（带极轻冷调）。两种落地方式，择一：
  1. **双方案合成（推荐）**：跑两个 scheme——一个用琥珀 seed 取 accent 族，一个用**冷中性 seed**（如近黑蓝灰 `#1a1c1e` 一类）取 surface / neutral / outline 族——再把两边对应角色拼成最终一套 token。
  2. **覆盖中性色钉值**：单 scheme 生成后，把 surface / surface-container-* / outline / surface-variant 等中性角色**钉为 M3 baseline 冷灰**，覆盖被暖染的值。
- 校验：明暗两套下 `surface`、`surface-container-*` 的色相应落在冷中性区（蓝灰向），目视不得偏米 / 偏棕。

> 当前 `globals.css` 与 teaser 的 token 是**手写快照**（注释标 SchemeFidelity，surface 已是冷中性灰、accent 是琥珀）。生成器落地后用其产物**替换**这份手写块，值应等价或更准。

### Token 如何生成（build 时，绝不在客户端）

用 `@material/material-color-utilities`，**仅在 build 期**跑生成脚本，产出静态 `.css`：

```text
argbFromHex("#F2A900")                       // seed → ARGB
→ Hct.fromInt(argb)                          // → HCT
→ new SchemeTonalSpot(srcHct, isDark, 0)     // 标准；或 SchemeExpressive 取更鲜明的调色板
→ 遍历 MaterialDynamicColors 全部静态角色：
   primary / onPrimary / primaryContainer / onPrimaryContainer
   primaryFixed / primaryFixedDim / onPrimaryFixed / onPrimaryFixedVariant
   secondary*… tertiary*… error*…
   surface / surfaceDim / surfaceBright
   surfaceContainerLowest / Low / Container / High / Highest   // 5 级必出
   surfaceVariant / onSurfaceVariant / outline / outlineVariant
   inverseSurface / inverseOnSurface / …
→ color.getArgb(scheme) → hexFromArgb(argb)  // 每角色明/暗各跑一次（isDark=false/true）
→ emit 静态 .css：:root{ --md-sys-color-*: … }（light）+ [data-theme="dark"]{ … }（dark）
```

要点：

- **明暗各跑一遍**（`isDark=false` / `true`），分别写进 `:root{}` 与 `[data-theme="dark"]{}`，外加 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"]){…}` 跟随系统。
- surface / neutral 族按上节"冷底"策略合成或钉值。
- **绝不在客户端跑 color-utilities**：内容页零 JS，运行时只读已生成的静态变量。
- 产物即承诺：脚本输出的 `.css` 直接被 `globals.css` 采纳，token 是单一来源。

### 接入 Tailwind 4

`globals.css` 用 `@theme inline` 把 sys 变量映射成 Tailwind 颜色工具类，**`inline` 关键**——使 `bg-surface`、`text-primary` 等工具类引用**运行时变量**，主题切换 / 系统偏好即时生效，无需重建：

```css
@theme inline {
  --color-primary:            var(--md-sys-color-primary);
  --color-primary-container:  var(--md-sys-color-primary-container);
  --color-primary-fixed-dim:  var(--md-sys-color-primary-fixed-dim);
  --color-surface:            var(--md-sys-color-surface);
  --color-on-surface:         var(--md-sys-color-on-surface);
  --color-surface-container-high: var(--md-sys-color-surface-container-high);
  --color-outline-variant:    var(--md-sys-color-outline-variant);
  /* …其余按需映射… */
}
```

→ 组件用 `bg-primary-container`、`text-on-surface-variant`、`border-outline-variant`、`bg-surface/70`（带透明度）等工具类，永不写死 hex。

## 字体与排版

| 用途 | 字体 | 字重 |
|---|---|---|
| 标题 / 正文 | **Plus Jakarta Sans**（几何变量无衬线） | 400–800 |
| 数字 / repo 名 / 轴标 | **Geist Mono** | 400 / 500 |

- **全站最多两个家族**（无衬线 + 等宽），符合性能预算。
- 子集化（latin） + woff2，目标 **~30KB**；web 用 `next/font/google` 自托管（`--font-plus-jakarta` / `--font-geist-mono` 变量），`display:swap`。
- **数字一律等宽 + `tabular-nums`**（`font-mono tabular-nums`）：榜单 / star 数 / 年份对齐不跳动，也利于 CLS。
- 标题走 M3 Display/Headline：大字号 + 重字重（700–800）+ 负字距（`tracking` ≈ −0.02em ～ −0.04em），体现"强层级、即时感"。

排版量级（参照实现，用 `clamp()` 流式）：

| 级别 | 大小 | 字重 / 字距 | 用途 |
|---|---|---|---|
| Display | `clamp(2.4rem, 7vw, 5rem)` | 800 / −0.04em | 首页 h1 |
| Headline | `clamp(1.5rem, 4vw, 2.4rem)` | 700 / −0.02em | 页面标题 |
| Title | `1.15rem` | 700–800 | 顶栏 logo、卡片标题 |
| Body | `clamp(1rem, 1.7vw, 1.25rem)` / `line-height 1.55` | 400 | 正文 / lede |
| Label（mono） | `0.7–0.8rem`，常 `uppercase tracking-wider` | 500 | 小节标、弱标签、轴标 |
| Metric（mono） | `0.72–1.5rem` `tabular-nums` | 500–800 | star 数、名次、增速 |

## 形状（Shape Scale）

M3 shape scale，token 化：

| token | 值 | 用途 |
|---|---|---|
| `--shape-xs` | `4px` | 焦点描边圆角、极小元素 |
| `--shape-s` | `8px` | 小 chip / tag |
| `--shape-m` | `12px` | `.hl` 高亮、热力图格、按钮 |
| `--shape-l` | `16px` | 卡片、脊柱行、容器 |
| `--shape-xl` | `28px` | 大卡片 / 浮层（squircle 观感） |
| `--shape-full` | `999px` | pill chip、圆形按钮、bar 端点、状态点 |

原则：pill（`full`）给状态 / 标签 / 名次徽标；squircle（`l`/`xl`）给内容容器；同一层级形状一致，不滥用混合圆角。

## 动效

token（与实现一致）：

```css
--ease-emphasized: cubic-bezier(0.2, 0, 0, 1);   /* M3 emphasized 收尾 */
--ease-spring: linear( 0, 0.006, 0.025 2.8%, …, 1.018 54.3%, …, 1 );  /* 弹簧（CSS linear()）*/
```

- **emphasized 缓动** `cubic-bezier(0.2,0,0,1)`：用于主题切换、背景 / 颜色过渡、淡入、状态脉冲。
- **弹簧** 用 CSS `linear()` 编码关键点（**build 期预计算弹簧曲线采样，不手写**）：用于 ★ pop、bar 生长、卡片 hover 抬升、按钮 active 回弹——带微过冲（>1）的"表现力"质感。
- **跨文档页面转场**：`@view-transition { navigation: auto; }`——**纯 CSS、零 JS**，多页静态站天然容器形变；浏览器不支持时无害降级。web 另用 `template.tsx` 的 `.page-enter` 淡入（template 每次导航重挂载，CSS 动画自然重放）。
- **服务端 SVG 的"绘制"动效**：star 曲线用 `stroke-dasharray/offset` 线条描绘 + 面积淡入（`.curve-line` / `.curve-area`），纯 CSS。
- **典型时长**：背景 / 文字过渡 300ms；hover / 工具类 150–200ms；入场 0.6–1s（带 stagger，`animation-delay` 递增 ~0.02–0.05s/项）。

**`prefers-reduced-motion` 兜底（强制）**：全局关闭 animation / transition，并把"动画终态"钉死（bar 直接 `scaleX/Y(var(--w/--h))`、曲线 `stroke-dashoffset:0`、面积 `opacity:1`），保证无动效时布局与终态完全正确：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .spine-bar { transform: scaleX(var(--w)); }
  .spine-bar-y { transform: scaleY(var(--h, 1)); }
  .curve-line { stroke-dashoffset: 0; }
  .curve-area { opacity: 1; }
}
```

## 高度（Elevation）

**tonal + 阴影双轨**：

- **tonal（主）**：用 5 级 `surface-container-*` 表达层级——越高的面用越"高"的 container（`lowest` 贴底 → `highest` 最浮）。明暗双模式各有 5 级冷灰。
- **阴影（辅）**：M3 软阴影 token，仅给真正"浮"起来的元素（浮层、hover 抬升）：

```css
--elev-1: 0 1px 2px rgb(var(--md-shadow-rgb)/.30), 0 1px 3px 1px rgb(var(--md-shadow-rgb)/.12);
--elev-2: 0 1px 2px rgb(var(--md-shadow-rgb)/.30), 0 2px 6px 2px rgb(var(--md-shadow-rgb)/.14);
```

- **毛玻璃**（顶栏 / 浮层）：`bg-surface/70 backdrop-blur-lg backdrop-saturate-150`（半透明 + 模糊饱和），M3E 标志质感，配 `border-outline-variant` 底边。

层级建议：页底 = `background`；常规卡片 = `surface-container` / `surface-container-low`；hover / 浮起 = 升一级 container（+ `elev`）；顶栏 = 毛玻璃 surface。

## 无障碍（a11y）

- **对比度 WCAG AA**：M3 的 tone 映射保证 `on-*` 与其配对面达 AA；金 accent 与冷 surface 的组合（含明暗双模式）须实测达标。亮金 `primary-fixed-dim` 是**装饰 / 大字重数字**用色，正文文字用 `on-surface` / `on-surface-variant`，不用低对比金做小正文。
- **focus-visible**：所有可聚焦元素可见焦点环——`outline-3 outline-offset-2 outline-primary`（按钮）/ `outline-2`（链接），`--shape-xs` 圆角。不可用 `outline:none` 去掉而不补。
- **键盘可达**：导航 / 榜单 / 脊柱 / 热力图格全是 `<Link>`，可 Tab 聚焦、Enter 激活；顺序符合视觉顺序。
- **语义化 HTML**：`<header>`/`<main>`/`<nav aria-label>`/`<footer>`/`<ol>`/`<figure>`；榜单用有序列表，图表用 `<figure>`。
- **SVG 无障碍**：曲线 / 热力图 `role="img"` + `aria-label`（含数值摘要，如"rises to 128k stars over 96 months"）；纯装饰 SVG（★、图标）`aria-hidden="true"`。复杂图表提供**视觉隐藏的数据表 fallback** 供屏幕阅读器。
- **reduced-motion**：见动效节，强制兜底。
- **color-scheme**：`html { color-scheme: light dark; }` 让原生控件 / 滚动条随主题。

## 组件清单（M3E 样式注记）

均为 RSC + Tailwind 工具类，零客户端 JS（除标注的主题切换按钮）。实现位于 `web/app/_explore/` 与 `web/app/components/`。

| 组件 | 文件 | M3E 样式注记 |
|---|---|---|
| **顶栏 Top App Bar** | `_explore/Chrome.tsx` | `sticky top-0`，毛玻璃 `bg-surface/70 backdrop-blur-lg backdrop-saturate-150` + `border-outline-variant` 底边；logo 含金 ★（`primary-fixed-dim`，`aria-hidden`）+ 800 字重 wordmark；可选 tag = `primary-container` pill；右侧 About 链接 + 主题切换。standalone 下 `padding-top: max(.85rem, env(safe-area-inset-top))` 避刘海。 |
| **搜索框 / Combobox** | `_explore/SearchBox.tsx` | **顶栏全站搜索**（`"use client"`，客户端 JS 例外但不在内容正文）：pill 容器（`rounded-full`）+ `focus-within:border-primary`；mono 输入、前置放大镜 icon（`aria-hidden`）；下拉面板 `surface-container-high` + 圆角 + 阴影（`elev`），命中行 hover `bg-on-surface/5`、激活行 `bg-on-surface/8`；a11y = `role="combobox"`/`listbox`/`option` + `aria-activedescendant`，键盘 ↑↓/Enter/Esc；首次聚焦懒加载 `search/index.json` + MiniSearch，结果直达 `/{owner}/{name}`；placeholder / 空态走 chrome i18n 七语。 |
| **Chip / Badge** | （`Chrome` tag、状态 chip） | pill（`shape-full`）；强调态 `bg-primary-container text-on-primary-container`；信息态 `tertiary-container` + 描边；状态点 `status-pulse` 脉冲动画（`tertiary`）。 |
| **Surface 卡片** | （工具类组合） | `bg-surface-container`/`-low` + `rounded-2xl`(`shape-l/xl`)；hover 升一级 container 或 `-translate-y` 抬升 + `elev`；内部用 tonal 区分而非重描边。 |
| **榜单行 Ranking Row** | `_explore/RankingList.tsx` | **编辑感、非数据表**：名次 = 金色大号 `tabular-nums`（`primary-fixed-dim`，1.5rem/800）；repo 名走 mono"数据声"（`owner/` 弱、`name` 强、hover 下划线）；语言 = `surface-container-high` 小 pill 弱标签；指标右对齐重权重（`+gained` / `+rate%` / `crossed`，`tabular-nums`）。整行 `<Link>` → repo 页，hover `-translate-y` + `bg-on-surface/5`，弹簧缓动，入场 stagger。 |
| **日历热力图格 Heatmap Cell** | `_explore/Heatmap.tsx` | **刻意不用 GitHub 绿**：强度用 `color-mix(in oklab, primary-fixed-dim t%, surface-container)`，从冷灰底渐变到亮金（`t` 按 `gained/max`，下限 0.08 保证可见）；格子 `rounded-xl` + `ring-outline-variant/30`；`square` → `aspect-square` 日历格 / 否则 `h-20`；可选 `<Link>` → 月页，hover 抬升；mono 标签。 |
| **Star 曲线 SVG** | `_explore/StarCurve.tsx` | **服务端渲染 SVG，零客户端 JS**：主线 `stroke=primary` 3px + 圆角接头；面积 `linearGradient` 琥珀渐隐（`primary-container` 0.5→0）；里程碑 = 金点（`primary-fixed-dim`，`surface` 描边）+ 虚线垂引 + 标签；mono 年份轴标（`on-surface-variant`）；`role="img"`+`aria-label` 摘要；CSS 线条描绘 + 面积淡入（reduced-motion 下钉终态）。 |
| **对比曲线 CompareCurve** | `_explore/CompareCurve.tsx` | **客户端组件**（`"use client"`，带 absolute↔对齐到 10k 切换——零 JS 约束的**例外④**，见下表）：N 条折线**无面积填充**、共享 y 轴；每条线取分类调色板 `--chart-cat-1..5`（5 色，琥珀/青/紫/绿/玫，OKLCH 选取在明暗两主题都够对比，build 期生成、不写死 hex）；图例 = 同色块 + `full_name` + 当前星数；模式切换为分段控件（`shape-full`，选中 `bg-primary-container text-on-primary-container`）；`role="img"`+`aria-label` 摘要 + 视觉隐藏数据表 fallback。 |
| **面包屑 / 上下页导航** | （年 / 月页内） | `<nav aria-label>`；上下月 / 年导航**永远在顶部**（强化"翻阅"感）；当前项 `on-surface`、相邻项 `on-surface-variant` + hover 转 `on-surface`；mono 字。 |
| **主题切换按钮** | `components/ThemeToggle.tsx` | **唯一客户端交互**（`"use client"`）：42px 圆形（`shape-full`）`bg-surface-container-high`，hover 升 `-highest`，`active:scale-90` 弹簧回弹，`focus-visible:outline-3 outline-primary`；日月图标用**纯 CSS 切换**（`[data-theme] .i-sun/.i-moon` 显隐），避免 hydration 闪烁。 |
| **页脚 Footer** | （teaser / layout） | `border-t border-outline-variant`；`on-surface-variant` 文字；链接 `tertiary`，hover 转 `primary` + 下划线；构建时间戳 mono（UTC + JST 双显示，权威时区约定见 [ARCHITECTURE.md](./ARCHITECTURE.md) §时间与时区，调性见 [PRODUCT.md](./PRODUCT.md)「视觉/交互细节」）。 |
| **年份脊柱 / 柱 Spine Bar** | `page.tsx` + `.spine-bar(-y)` | 条 = `primary-container`，峰值年 = `primary-fixed-dim`；`shape-full`/`rounded-t-xl`；宽 / 高用 `--w`/`--h`（`gained/max`）；弹簧生长动画，hover `-translate-y` + `brightness-105`；整柱 `<Link>` → 年页，mono 年份标。 |

## 零客户端 JS 约束与各交互的处理

内容页 **0 客户端 JS**（见 ARCHITECTURE 性能策略）。每处"看似要 JS"的交互如何纯 CSS / 服务端解决：

| 交互 | 处理 | JS? |
|---|---|---|
| 图表（曲线 / 热力图 / 脊柱） | **服务端渲染 SVG / DOM**；动画用 CSS（`stroke-dashoffset` 描绘、`scaleX/Y` 生长、`color-mix` 强度） | 无 |
| 页面转场 | `@view-transition { navigation: auto; }`（跨文档）+ `template.tsx` `.page-enter` 重挂载淡入 | 无 |
| hover / active / 焦点反馈 | 纯 CSS（`:hover`/`:active`/`:focus-visible` + transition / 弹簧） | 无 |
| 状态脉冲、★ pop、入场 stagger | CSS `@keyframes` + `animation-delay`（行内 `--w/--h/delay` 变量） | 无 |
| 明暗主题"跟随系统" | CSS：`@media (prefers-color-scheme)` + `[data-theme]` 变量切换；图标 CSS 显隐 | 无 |
| **主题手动切换** | 例外①。`ThemeToggle`（`"use client"`）写 `data-theme` + `localStorage` + 同步 `meta[theme-color]` | 极小 |
| **防主题闪烁（no-FOUC）** | 例外②（内联脚本）。`<head>` 内同步小脚本：读 `localStorage.theme`，显式覆盖则 paint 前设 `data-theme` + `theme-color`；否则跟随系统。`<html suppressHydrationWarning>` | 内联 1 段 |
| **PWA / standalone** | 例外③。`RegisterSW`（`"use client"`）注册 Service Worker（失败静默）+ `manifest.ts`；不渲染正文、不影响爬虫拿全量 HTML | 极小 |
| **多 repo 对比页** | 例外④（仅限 `/compare`）。`CompareCurve` + 选择器（`"use client"`）：按需取曲线、归一化切换本质是**交互式探索工具**，无法服务端静态化。**只此一页**，不渗入内容正文页（repo/榜单/org 仍 0 JS） | 客户端 |

> 规则：客户端 JS 仅限**四处明确例外**——防闪烁内联脚本、主题切换按钮、PWA SW 注册（`RegisterSW` + `manifest`）、以及 `/compare` 对比工具页（例外④，不渗入内容正文页）。任何**新**交互都必须能纯 CSS / 服务端实现，否则需重新设计而非引入客户端 JS。内容正文页（repo / 榜单 / org / 首页）SVG 图表一律服务端渲染。

## 落地核对清单

- [ ] token 由 build 期生成脚本产出，accent 取琥珀 seed、surface / neutral 走冷中性灰（合成或钉值），明暗各一套 + 跟随系统
- [ ] 生成器产物替换 `globals.css` / teaser 的手写 token 块，值等价或更准
- [ ] `@theme inline` 映射就位，工具类引用运行时变量、主题切换即时生效
- [ ] 字体两家族、latin 子集、woff2 ~30KB、`tabular-nums` 用于所有数字
- [ ] 形状 / 动效 / 高度全部 token 化，无写死 hex / px 调色板
- [ ] 弹簧 `linear()` 关键点 build 期预计算
- [ ] `prefers-reduced-motion` 全局兜底 + 动画终态钉死
- [ ] 对比度 AA 实测（含明暗、金 / 冷灰组合）；focus-visible 全覆盖；SVG `aria-label` + 数据表 fallback
- [ ] 内容页正文零客户端 JS，仅四处例外（防闪烁脚本 / 主题切换 / PWA SW 注册 / `/compare` 对比工具页）
