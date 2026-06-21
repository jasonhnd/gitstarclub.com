# gitstarclub 设计系统

> 本文档是视觉与交互的**唯一真相源**：色彩 / 字体 / 形状 / 动效 / 高度 / 无障碍 / 组件清单 / 零客户端 JS 约束。
> 调性与页面见 [PRODUCT.md](./PRODUCT.md)，架构与渲染见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
> 落地实现：teaser `src/index.html`（内联 token）与 web 应用 `web/app/globals.css`（`@theme` 接 Tailwind 4），二者 token 值一致。

## Scope

本文档描述设计系统：token（色彩 / 形状 / 动效 / 高度）、字体与排版、组件清单、动效规则、无障碍规则，以及零客户端 JS 约束与其具名例外。在新增任何 UI 表面或修改任何 token 之前先读本文档。

## 设计方向与原则

**Material 3 Expressive（M3E）**——鲜明动态色彩、强字体层级、圆润形状、弹簧动效、tonal elevation、毛玻璃。差异化靠 **冷石墨灰中性底 + 金"星"accent + 表现力动效**，明确避开暖米色（Claude 官网观感）。

核心原则（按优先级）：

1. **零客户端 JS 优先**：**内容正文表面**（榜单 / 热力图 / repo 正文 / org 正文 / star 曲线）一律 RSC + 服务端渲染 SVG，正文动效纯 CSS。客户端 JS 仅限末节列出的**三类具名例外**：(a) 内联脚本（防闪烁 themeInit，唯一一处），(b) i18n cookie 驱动的 chrome（顶栏 / 页脚 / 面包屑 / 叙事），(c) 交互式工具（搜索 / 分享 / `/compare` 对比页 / 主题切换 / 语言切换 / PWA SW 注册）。
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
| `secondary` | `#785923` | `#eac080` | 次级文字 / 图标（M3 secondary 角色） |
| `on-secondary` | `#ffffff` | `#432c00` | secondary 填充上的前景 |
| `secondary-container` | `#ffd391` | `#5e420c` | 次级强调面 |
| `on-secondary-container` | `#795a23` | `#d7af70` | secondary 面前景 |
| `tertiary` | `#00668a` | `#9edaff` | 青色互补：链接、状态 chip |
| `on-tertiary` | `#ffffff` | `#00344a` | tertiary 填充上的前景 |
| `tertiary-container` | `#3fc3ff` | `#3fc3ff` | 青色强调面 |
| `on-tertiary-container` | `#004e6b` | `#004e6b` | 青色面前景 |
| `background` / `surface` | `#fbfbfd` | `#121316` | **冷石墨灰中性底**（极轻冷调，非暖米 / 暖棕） |
| `on-background` | `#1a1c1e` | `#e3e2e6` | 背景上的主要前景文字 |
| `on-surface` | `#1a1c1e` | `#e3e2e6` | 主要前景文字 |
| `on-surface-variant` | `#43474e` | `#c3c7cf` | 次要文字、弱标签、轴标 |
| `surface-variant` | `#dfe2eb` | `#43474e` | 弱填充面 |
| `surface-dim` | `#dadce0` | `#121316` | 最暗 surface 变体（背景下沉） |
| `surface-bright` | `#fbfbfd` | `#38393c` | 最亮 surface 变体（强调浮起） |
| `surface-container-lowest→highest` | 5 级（`#ffffff`→`#e3e3e7`） | 5 级（`#0d0e11`→`#333538`） | **tonal elevation 层级**（冷中性灰） |
| `outline` / `outline-variant` | `#73777f` / `#c3c7cf` | `#8d9199` / `#43474e` | 分隔线、描边、ring |
| `inverse-surface` / `inverse-on-surface` | `#2f3033` / `#f1f0f4` | `#e3e2e6` / `#2f3033` | 反色面（toast / 选区） |

辅助 token：`--md-shadow-rgb: 0 0 0`（阴影基色，供 elevation 用）。

### 冷底 + 金点的理由与做法

**问题**：从单一暖琥珀 seed 跑标准 M3 方案（无论生成器还是手取），会把 surface / outline / neutral 全部染成暖米暖棕——正是要避开的 Claude 观感。

**做法（surface 与 seed 解耦）**：

- **accent 角色**（`primary` / `primary-container` / `primary-fixed-dim` / `on-primary*` / `secondary*`）→ 取自琥珀 seed `#F2A900`，保留品牌金。
- **surface / background / outline / surface-variant / inverse / neutral 系** → **不取暖 seed 的中性色**，改用 M3 baseline **冷中性灰**（带极轻冷调）。手工挑值，两边色相落在冷中性区（蓝灰向），目视不得偏米 / 偏棕。

### Token 如何落地（手写、静态、不在客户端跑）

色彩 token **不由运行时生成器产出**，而是**手写在 `web/app/globals.css`**——遵循 Material 3 系统色角色分类（system color roles），明暗两套 + 跟随系统：

- `:root{}` 承载 light token；`[data-theme="dark"]{}` 承载显式 dark；`@media (prefers-color-scheme: dark) :root:not([data-theme="light"]){…}` 跟随系统。
- accent 族（primary / primary-container / primary-fixed-dim / secondary*）取自琥珀 seed 推导的色阶；surface / neutral / outline 族**手工钉**为冷中性灰，按 surface-container 5 级 + dim/bright + variant 编排。
- **不引入 `@material/material-color-utilities`**：依赖列表保持精简，避免在运行时（甚至 build 期）引入 ARGB / HCT 推导链。当前 `globals.css` 是**唯一来源**，token 值即承诺。
- 内容页运行时**只读静态变量**，无 JS 色彩推导。

> 当前 `globals.css` 与 teaser 的 token 块是手写快照（M3-derived 但人工微调）。后续若改色，直接编辑 `globals.css` 这份手写块，不引入生成器。

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
- 子集化（latin） + woff2，目标 **~30KB**；web 用 `next/font/google` 自托管（`--font-plus-jakarta` / `--font-geist-mono` 变量，`subsets: ["latin"]`），`display: swap`（依赖 `next/font` 默认值——`layout.tsx` 未显式传 `display` 选项，next/font 默认即 `swap`）。
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

内容正文表面（榜单、图表、repo/org/年/月/首页正文）均为 RSC + Tailwind 工具类，零客户端 JS。少数 chrome / 交互工具组件标注 `"use client"`——见上一节"客户端 JS 例外清单"。实现位于 `web/app/_explore/` 与 `web/app/components/`。

| 组件 | 文件 | M3E 样式注记 |
|---|---|---|
| **顶栏 Top App Bar** | `_explore/Chrome.tsx` | `sticky top-0`，毛玻璃 `bg-surface/70 backdrop-blur-lg backdrop-saturate-150` + `border-outline-variant` 底边；logo 含金 ★（`primary-fixed-dim`，`aria-hidden`）+ 800 字重 wordmark；可选 tag = `primary-container` pill；右侧 About 链接 + 主题切换。standalone 下 `padding-top: max(.85rem, env(safe-area-inset-top))` 避刘海。 |
| **搜索框 / Combobox** | `_explore/SearchBox.tsx` | **顶栏全站搜索**（`"use client"`，客户端 JS 例外但不在内容正文）：pill 容器（`rounded-full`）+ `focus-within:border-primary`；mono 输入、前置放大镜 icon（`aria-hidden`）；下拉面板 `surface-container-high` + 圆角 + 阴影（`elev`），命中行 hover `bg-on-surface/5`、激活行 `bg-on-surface/8`；a11y = `role="combobox"`/`listbox`/`option` + `aria-activedescendant`，键盘 ↑↓/Enter/Esc；首次聚焦懒加载 `search/index.json` + MiniSearch，结果直达 `/{owner}/{name}`；placeholder / 空态走 chrome i18n 七语。 |
| **Chip / Badge** | （`Chrome` tag、状态 chip） | pill（`shape-full`）；强调态 `bg-primary-container text-on-primary-container`；信息态 `tertiary-container` + 描边；状态点 `status-pulse` 脉冲动画（`tertiary`）。 |
| **Surface 卡片** | （工具类组合） | `bg-surface-container`/`-low` + `rounded-2xl`(`shape-l/xl`)；hover 升一级 container 或 `-translate-y` 抬升 + `elev`；内部用 tonal 区分而非重描边。 |
| **榜单行 Ranking Row** | `_explore/RankingList.tsx` | **编辑感、非数据表**：名次 = 金色大号 `tabular-nums`（`primary-fixed-dim`，1.5rem/800）；repo 名走 mono"数据声"（`owner/` 弱、`name` 强、hover 下划线）；语言 = `surface-container-high` 小 pill 弱标签；指标右对齐重权重（`+gained` / `+rate%` / `crossed`，`tabular-nums`）。整行 `<Link>` → repo 页，hover `-translate-y` + `bg-on-surface/5`，弹簧缓动，入场 stagger。 |
| **日历热力图格 Heatmap Cell** | `_explore/Heatmap.tsx` | **刻意不用 GitHub 绿**：强度用 `color-mix(in oklab, primary-fixed-dim t%, surface-container)`，从冷灰底渐变到亮金（`t` 按 `gained/max`，下限 0.08 保证可见）；格子 `rounded-xl` + `ring-outline-variant/30`；`square` → `aspect-square` 日历格 / 否则 `h-20`；可选 `<Link>` → 月页，hover 抬升；mono 标签。 |
| **Star 曲线 SVG** | `_explore/StarCurve.tsx` | **服务端渲染 SVG，零客户端 JS**：主线 `stroke=primary` 3px + 圆角接头；面积 `linearGradient` 琥珀渐隐（`primary-container` 0.5→0）；里程碑 = 金点（`primary-fixed-dim`，`surface` 描边）+ 虚线垂引 + 标签；mono 年份轴标（`on-surface-variant`）；`role="img"`+`aria-label` 摘要；CSS 线条描绘 + 面积淡入（reduced-motion 下钉终态）。 |
| **对比曲线 CompareCurve** | `_explore/CompareCurve.tsx` + `compare/CompareClient.tsx` | **客户端组件**（`"use client"`，带 absolute↔对齐到 10k 切换——属"交互式工具"例外类，仅限 `/compare`，见下节例外清单）：N 条折线**无面积填充**、共享 y 轴；每条线取分类调色板 `--chart-cat-1..5`（5 色，琥珀/青/紫/绿/玫，OKLCH 选取在明暗两主题都够对比，不写死 hex）；图例 = 同色块 + `full_name` + 当前星数；模式切换为分段控件（`shape-full`，选中 `bg-primary-container text-on-primary-container`）；`role="img"`+`aria-label` 摘要 + 视觉隐藏数据表 fallback。 |
| **面包屑 / 上下页导航** | （年 / 月页内） | `<nav aria-label>`；上下月 / 年导航**永远在顶部**（强化"翻阅"感）；当前项 `on-surface`、相邻项 `on-surface-variant` + hover 转 `on-surface`；mono 字。 |
| **主题切换按钮** | `components/ThemeToggle.tsx` | 客户端交互（`"use client"`，属"交互式工具"例外类）：42px 圆形（`shape-full`）`bg-surface-container-high`，hover 升 `-highest`，`active:scale-90` 弹簧回弹，`focus-visible:outline-3 outline-primary`；日月图标用**纯 CSS 切换**（`[data-theme] .i-sun/.i-moon` 显隐），避免 hydration 闪烁。 |
| **页脚 Footer** | `_explore/Footer.tsx` | `border-t border-outline-variant`；`on-surface-variant` 文字；链接 `tertiary`，hover 转 `primary` + 下划线；构建时间戳 mono（UTC + JST 双显示，权威时区约定见 [ARCHITECTURE.md](./ARCHITECTURE.md) §时间与时区，调性见 [PRODUCT.md](./PRODUCT.md)「视觉/交互细节」）。 |
| **年份脊柱 / 柱 Spine Bar** | `page.tsx` + `.spine-bar(-y)` | 条 = `primary-container`，峰值年 = `primary-fixed-dim`；`shape-full`/`rounded-t-xl`；宽 / 高用 `--w`/`--h`（`gained/max`）；弹簧生长动画，hover `-translate-y` + `brightness-105`；整柱 `<Link>` → 年页，mono 年份标。 |

## 零客户端 JS 约束与各交互的处理

### 真实约束（不是"全站零 JS"）

内容**正文表面**（榜单 / 热力图 / repo 正文 / org 正文 / star 曲线 / 年份脊柱）一律 **RSC + 服务端渲染 SVG**，正文动效纯 CSS。但因 **i18n cookie 驱动的语言切换**模型（URL 保持规范、cookie 后水合后由 client provider 替换字符串，详见 [ARCHITECTURE.md](./ARCHITECTURE.md) §i18n），页面的 **chrome 部分**（顶栏 / 页脚 / 面包屑 / 叙事）必须在客户端挂载才能在切换语言时即时刷新副本——这是有意的设计决策。

**幸存的硬规则**：图表（曲线 / 热力图 / 脊柱）与**内容正文表面**（榜单行、repo 详情、org 详情、首页页面正文）必须保持 RSC + 服务端 SVG，永不引入客户端 JS。例外仅限：(a) 内联引导脚本，(b) 参与 i18n cookie 切换的 chrome，(c) 真正的交互式工具（搜索 / 分享 / 对比 / 主题 / 语言切换）。

### 每处"看似要 JS"的交互如何纯 CSS / 服务端解决

| 交互 | 处理 | 客户端 JS? |
|---|---|---|
| 图表（曲线 / 热力图 / 脊柱） | **服务端渲染 SVG / DOM**；动画用 CSS（`stroke-dashoffset` 描绘、`scaleX/Y` 生长、`color-mix` 强度） | 无 |
| 榜单 / repo 正文 / org 正文 / 首页正文 | RSC，HTML 静态产出 | 无 |
| 页面转场 | `@view-transition { navigation: auto; }`（跨文档）+ `template.tsx` `.page-enter` 重挂载淡入 | 无 |
| hover / active / 焦点反馈 | 纯 CSS（`:hover`/`:active`/`:focus-visible` + transition / 弹簧） | 无 |
| 状态脉冲、★ pop、入场 stagger | CSS `@keyframes` + `animation-delay`（行内 `--w/--h/delay` 变量） | 无 |
| 明暗主题"跟随系统" | CSS：`@media (prefers-color-scheme)` + `[data-theme]` 变量切换；图标 CSS 显隐 | 无 |

### 客户端 JS 例外清单（按类别）

**(a) 内联脚本**（直接写入 HTML，非组件）

| 位置 | 用途 |
|---|---|
| `web/app/layout.tsx:56`（`themeInit` const → `:67` 内联 `<script dangerouslySetInnerHTML>`） | 防主题闪烁（no-FOUC）：paint 前读 `localStorage.theme`，显式覆盖则设 `data-theme` + 同步 `meta[theme-color]`；否则跟随系统。`<html suppressHydrationWarning>`（`:65`）配合。这是**唯一**真正的内联脚本——`themeInit` 是裸字符串注入 `<script>`，不是组件。 |

**(b) i18n cookie 驱动的 chrome**（包裹正文的客户端壳层，因语言 cookie 切换需要即时重渲染）

| 文件 | 用途 |
|---|---|
| `web/app/_explore/Chrome.tsx` | 顶栏：i18n-aware logo / 链接 / 标签；包含搜索框与语言切换器。 |
| `web/app/_explore/Footer.tsx` | 页脚：i18n-aware 文案 + 构建时间戳本地化（UTC + JST）。 |
| `web/app/_explore/Breadcrumbs.tsx` | 面包屑：路径段在切语言时即时本地化。 |
| `web/app/_explore/Narrative.tsx` | 叙事段落 / lede：copy 由 chrome i18n 字典出，cookie 切换即时刷新。 |

**(c) 交互式工具**（行为本质需客户端状态 / 事件）

| 文件 | 用途 |
|---|---|
| `web/app/_explore/SearchBox.tsx` | 全站搜索：首次聚焦懒加载 `search/index.json` + MiniSearch，键盘 ↑↓/Enter/Esc，命中跳 `/{owner}/{name}`。 |
| `web/app/_explore/ShareButton.tsx` | 分享按钮：调用 Web Share API / 复制链接到剪贴板。 |
| `web/app/_explore/CompareCurve.tsx` + `web/app/compare/CompareClient.tsx` | `/compare` 对比工具页：按需取曲线、absolute ↔ 对齐到 10k 切换、归一化。**仅限 `/compare`**，不渗入内容正文页。 |
| `web/app/components/ThemeToggle.tsx` | 主题切换按钮：写 `data-theme` + `localStorage` + 同步 `meta[theme-color]`。 |
| `web/app/components/LanguageSwitcher.tsx` | 语言切换器：写 i18n cookie，触发 chrome 字典重读。 |
| `web/app/_explore/RegisterSW.tsx` | PWA / standalone：`"use client"` **组件**（在 `layout.tsx:76` 渲染，非内联脚本），注册 Service Worker（失败静默）+ `manifest.ts`；不渲染正文、不影响爬虫拿全量 HTML。 |

> **规则**：内容正文表面（榜单、repo / org / 月 / 年 / 首页正文、所有 SVG 图表）一律 RSC，永不引入客户端 JS。任何**新**交互必须落入上述三类例外之一，否则需重新设计而非引入客户端 JS。新的客户端组件必须同步加入此清单。

## 落地核对清单

- [ ] 色彩 token 手写在 `web/app/globals.css`（遵循 M3 system color roles），accent 取琥珀 seed、surface / neutral 走冷中性灰，明暗各一套 + 跟随系统
- [ ] 不引入 `@material/material-color-utilities`；改色直接编辑 `globals.css` 手写 token 块
- [ ] `@theme inline` 映射就位，工具类引用运行时变量、主题切换即时生效
- [ ] 字体两家族、latin 子集、woff2 ~30KB、`tabular-nums` 用于所有数字
- [ ] 形状 / 动效 / 高度全部 token 化，无写死 hex / px 调色板
- [ ] `prefers-reduced-motion` 全局兜底 + 动画终态钉死
- [ ] 对比度 AA 实测（含明暗、金 / 冷灰组合）；focus-visible 全覆盖；SVG `aria-label` + 数据表 fallback
- [ ] 内容正文表面（榜单 / 图表 / repo 正文 / org 正文 / 首页正文）零客户端 JS；客户端 JS 仅限三类具名例外（内联脚本 / i18n chrome / 交互式工具），具体文件清单见§零客户端 JS 约束
