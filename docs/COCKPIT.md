---
owner: product
status: active
last_reviewed: 2026-08-22
source_of_truth_for:
  - cockpit content contract
  - cockpit visual encoding
  - cockpit intel rules
  - cockpit interaction
  - cockpit reader jobs
---

# GitStar Cockpit — 内容契约

> 本文从**读者要干什么**锁画面。视觉稿只是示意；与本文冲突时以本文为准。
>
> **不是已上线路由。** 不授权新开 `/cockpit`，不授权绕过 [ROADMAP.md](./ROADMAP.md) Track C。
>
> 产品调性与数据诚实归 [PRODUCT.md](./PRODUCT.md)。榜单口径归 [RANKING.md](./RANKING.md)。分类归 [CATEGORIES.md](./CATEGORIES.md)。字段形状归 [DATA-CONTRACTS.md](./DATA-CONTRACTS.md)。内部指标名（flow / stock）只出现在本文 §9，不出现在玻璃上。

## 读者是谁、来干什么

站点已经回答两件事：[INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md) 的 Pulse（现在谁在动）和 Rankings（谁最大、哪一段谁赢了）。Cockpit 不发明第三套榜单。它让同一个人**看见运动，并能把时间拖回去**。

目标读者仍是 [PRODUCT.md](./PRODUCT.md) 的开发者、技术媒体、研究者——他们会搜一个项目名，会引用 as-of，不会来学「flow / Momentum / p90」。

打开后 **5 秒内**必须成立：

1. 中间是一片正在动的开源项目，不是一张表。
2. 已经有一个项目被讲完，不用先点。
3. 看得出当前在看「这个月」。
4. 看得出底下有一条能拖的时间轴；鼠标一拉，中间那片点跟着变。

四件读者任务，按优先级：

| 任务 | 读者心里的话 | Cockpit 怎么接 |
|---|---|---|
| **看天气** | 这阵子开源在涨什么？ | 雷达 + 左侧三条头条 + 默认讲涨得最多的那个 |
| **跟一个项目** | 它是怎么长到今天的？ | 选中后：故事栏 + 时间轴上它的 10k/50k/100k；拖到那天就看到当时 |
| **找邻居** | 同类还有谁？ | Nearby 三个点；Compare |
| **倒带世界** | 2019 年长什么样？它破 10 万那天呢？ | 用鼠标在全历史轴上来回拖；点里程碑是跳到那天 |

做不到这四件事的控件，不进第一版。

---

## 这版改了什么（相对上一份锁）

上一份从数据模块出发，读者要先学会我们的词。这版改成读者的词。冲突时以这版为准。

| 旧锁 | 新锁 | 为什么 |
|---|---|---|
| 左侧 5 条 Rising / Accelerating / Persistent Growth / New Entrants / Category Movers | 左侧 **3 条头条**：Moving now / Speeding up / New on the map | 五条并列是控制室，不是阅读。读者一次只看「谁在涨、谁在加速、谁刚进万星」 |
| 芯片 `1W 1M 1Y ALL` | 芯片只要 **This week / This month / This year**。时间轴永远是全历史 | `ALL` 在时间条上看起来像「整段历史」，实际却在改「什么叫在动」。两件事不要绑一个键 |
| 右侧同等的 7d / 30d / 1y + Momentum + Acceleration | 故事栏主句跟当前芯片一致（This month +9.2k）；「比上月」用白话；不要 Very high | 同一项目左边 this month、右边 7d，读者会对哪一个是真的 |
| 时间轴主操作是 Play | **主操作是鼠标来回拖时间轴**。Play 只是可选的自动滑动，不是这个舱存在的理由 | 打开时头在今天很正常；读者往左拖就能回到 2019 |
| Persistent Growth 独立成条 | 撤掉。若选中项目连涨 3 个月，写在故事栏一句 | 那是这个项目的属性，不是全球头条 |
| Category Movers 独立成条 | 撤掉。分类名次变化写在故事栏 `In AI / ML  #2  was #4` | 读者关心「它在自己那类里的位置」，不是第五条头条 |

---

## 锁定决策

| 决策 | 锁定值 |
|---|---|
| 默认打开 | This month；播放头 = 今天；故事 = 本月涨星最多的项目 |
| 「在动」的含义 | 由芯片决定：This week / This month / This year |
| 时间轴范围 | 永远从数据最早月 → 今天。没有 ALL 键 |
| 左侧头条 | 3 条，每条一个 repo，规则见 §3 |
| 故事栏主增量 | **与芯片同一句话**（This month / This week / This year） |
| 节点大小 | 体量（今天的 stars；拖历史则当时的累计） |
| 节点亮 / 尾 | 亮 = 这窗在涨；尾 = 比上一窗涨得更快 |
| 节点颜色 | 领域；图例 5 组：AI / Dev Tools / Database / Infra / Web |
| 雷达前景 | 体量或本窗涨幅进前约 400；其余极淡 |
| 玻璃上的语言 | 默认英文。禁止 flow、stock、Momentum、Acceleration、p90、intel |
| 雷达怎么画 | **先用 Three.js 做出能看的星空**。好看再留；太重或太像游戏，再换成更轻的画法。数据帧不变 |

---

## 1. 顶栏

读者要认出这是 GitStarClub，并且能搜自己已经知道的名字。

| 画面 | 读者得到什么 |
|---|---|
| `★ GitStarClub` + `Cockpit` | 还在这个产品里，只是换成探索模式 |
| `Explore how open source moves` | 这句话就是任务 |
| Search | 输入已知 `owner/name`，在雷达里选中它，不先踢去详情页 |
| 日期 | 「这些数算到哪一天」——和全站 as-of 同一套 |

语言、主题与现站相同。

---

## 2. 雷达（天气）

读者应感到：每个亮点是一个真实项目；大的是星多的；在闪的是这阵子在涨的。

Hover 只说人话：

```text
huggingface/transformers
164.1k stars
+9.2k this month
```

最多约 6 个名字印在图上（本窗涨得最多的、体量极大的、当前选中的）。不要把图做成标签云。

点一下：右边换成这个项目的故事，底下时间轴换成它的 10k / 50k / 100k。不要空选中——打开时已经在讲「这月涨最多的那个」。

不做缩放、不做漫游。要找认识的项目，用 Search。

---

## 3. 左侧头条（天气的标题）

不是菜单。三条，永远这个顺序，每条一个项目。

| 玻璃上的标题 | 读者听成 | 规则（内部，见 §9） |
|---|---|---|
| **Moving now** | 这阵子涨最多的 | 本窗净增星第 1，且 > 0 |
| **Speeding up** | 比上一阵更快的 | 本窗净增 > 0，且比上一窗多得最多 |
| **New on the map** | 刚进万星宇宙的 | 本窗**首次**跨过 10k（冻结里程碑） |

每条只放：

- 标题
- `owner/name`
- 现在的 star 数
- 一句增量：`+9.2k this month`（随芯片改 week / year）
- 一条 90 日小曲线（让人感到在动，不读坐标）

Speeding up 的角标可以是白话 `faster than last month`，不要 `+38%` 单独飞在标题上（百分比没有基数，读者会虚）。

点一条 = 选中这个项目。三条名单只随芯片变，不随选中变。选中的那条轻轻高亮。

某条本窗没人：标题留下，项目处 `—`。不要把上个月的「新晋」留到这个月。

---

## 4. 右侧故事（跟一个项目）

读者刚点完（或默认已经在看）一个项目。这里只回答：它现在多大、这阵子涨了多少、在同类里排第几、附近是谁、我能对比或看全文。

默认英文，结构锁定：

```text
huggingface/transformers
164.1k stars                    ← 播放头时刻；不在今天则加 as of 2019-07

This month          +9.2k       ← 与芯片同一句话
vs last month       faster      ← 比上一窗多；没有上一窗则 —
In AI / ML          #2  was #4  ← registry 分类名，禁止 Local AI

Last 90 days        [curve]

Nearby              pytorch · diffusers · datasets

[Compare]  [Full history]
```

芯片切到 This week / This year 时，第一行改成 `This week` / `This year`。不要同时再摆 7d / 30d / 1y 三块——那是第二套钟。

90 日曲线已经给「最近长什么样」。读者要十年曲线，走 Full history。

若这个项目**连续 3 个日历月**都在涨，在 `vs last month` 下加一句 `3rd month climbing`。这是故事属性，不是全球头条。

Nearby：现有 related（同属主或同语言，按体量截 3）。点 Nearby = 换成讲那个项目。Compare = 带上当前项目去 `/compare`。Full history = `/{owner}/{name}`。

---

## 5. 时间轴（倒带）

这是数据舱相对现站列表的独特能力：**用鼠标在时间上走来走去**。不是按一下 Play 等它自己放完。

轴永远是全历史。头默认停在今天。读者往左拖，就是回到过去；往右拖，回到今天。中间的点、选中项目的大数字，都跟头走。

| 读者动作 | 应该发生的事 |
|---|---|
| 按住轴上的头左右拖 | 雷达立刻变成**那个时候**：点的大小是当时体量，亮的是那一窗在涨的 |
| 点轴上空白 | 头跳到那一年/月 |
| 点 10k / 50k / 100k | 跳到选中项目真正跨过那天（冻结里程碑，不是估的） |
| This week / This month / This year | 只改变「什么叫在涨」，不缩短轴。轴还是全历史 |
| Play（可选） | 头沿轴自动滑。可有，不是主路径。已经在今天时，自动滑应从读者能理解的起点开始，或干脆不提供自动滑 |
| `prefers-reduced-motion` | 不要自动滑；拖和点仍然可用 |

事件点只属于**当前选中项目**。禁止写「Ollama 0.3 release」这种手填发行说明。

---

## 6. 打开时

1. 芯片 = This month。
2. 播放头 = 今天。
3. 雷达 = 这个月在动的宇宙。
4. 三条头条 = 本月 Moving now / Speeding up / New on the map。
5. 故事栏 = Moving now 那个项目。
6. 轴上的点 = 该项目的 10k / 50k / 100k。

概念图可以用 `huggingface/transformers` 充当 Moving now，好让名字认得出来。上线后必须是该窗净增第 1，不得写死。

---

## 7. 交互（读者路径）

始终在讲一个项目。

**来找天气的人：** 打开就能看。点头条或点雷达，右边换成那个项目。把芯片拨到 This week，三条头条换成周的。不必学任何指标名。

**带着名字来的人：** Search 命中即选中。不在 400 个亮点里也要能选中，并临时画进前景。

**想看它怎么长的人：** 拖时间轴，或点轴上的 10k。大数字跟着当时走。故事栏主句（This month +9.2k）**仍说相对今天的这窗**，避免「2019 年的 this month」这种假账；只让大数字和雷达体量穿越。大数字旁出现 `as of Jul 2019`。

**想找邻居的人：** Nearby 换选中；Compare 离开去叠曲线。

点雷达空白：不取消选中。

键盘：← → 按月/周挪头；Home / End = 最早 / 今天。Space 只有在提供 Play 时才是自动滑。

---

## 8. 玻璃上禁止

| 禁止 | 读者会怎样 |
|---|---|
| flow / stock / Momentum / Acceleration / intel / p90 | 这是我们的词，不是他们的任务 |
| `ALL` 键、`3M` 键 | 时间轴已经是全部；三个月没有榜 |
| 左侧写 7d / 30d，右侧再写 This month | 两个钟 |
| Very high / exploding / breakout | 像在打分，不像在陈述 |
| 自造分类名 | 对不上分类页 |
| 五条以上并列头条 | 不知道先看哪句 |
| 时间轴拖了中间的点却不动 | 独特能力死掉 |
| 白名单外的项目、编造的 10k 日期、LLM 摘要 | 破坏全站诚实 |

示例数字不是契约。上线用该 as-of 的真实视图。

---

## 9. 内部映射（不写在玻璃上）

实现对照用。读者不需要知道这些名字。

| 玻璃 | 内部 |
|---|---|
| 体量 / 大数字 stars | `current_stars`；历史月末 `curve.monthly.total_end` |
| This week / month / year 的 +k | 对应窗 repo **flow**（净增，可负则该项目不进 Moving now） |
| faster / slower / — | `flow_t − flow_{t-1}`。分母 floor 100 只用于是否入选 Speeding up 的排序，玻璃默认不展示百分比 |
| New on the map | 已有 new 榜 / 冻结 `crossed_10k` |
| In {label} #n was #m | 主 `domain` 的 `rank` + `prev_rank`，label 来自 registry |
| 3rd month climbing | 连续 3 个日历月 flow > 0 |
| 亮 | 本窗 flow > 0 |
| 尾 | `flow_t > flow_{t-1}` |
| 颜色 5 组 | `ai-ml` → AI；`devtools` → Dev Tools；`data-db` → Database；`infra-cloud` → Infra；`web-frontend`+`web-backend` → Web |
| Nearby | 现有 related 规则 |
| 90 日曲线 | `curve.recent_daily` 累计 |

已有增速榜（flow / 期初 stock）仍只活在 ranking 页，不进 Cockpit 玻璃。

---

## 10. 实现边界（本文不授权开工）

预计算视图可以做「400 点雷达包」和「三条头条」。不能在浏览器扫 5,300 份 entity。不能在请求路径上跑引擎。白名单外下钻、任意分面仍归 Track C。

---

## 11. 雷达怎么画（先 Three.js）

还没人见过「用鼠标来回拖时间轴时，这片星长什么样」。在看清效果之前，**不关掉 Three.js**。

顺序锁定：

1. **先做 Three.js 样片**（中间星空 + 可拖时间轴；左右栏可用静态壳）。目的是看：拖的时候光、尾巴、深度跟不跟得上。不是做游戏，也不是做自动播放器。
2. 样片过关：拖轴时点在变，像概念图，而不是 Excel 散点图 → **就留 Three.js**，用动态加载，只有打开数据舱才下载。
3. 样片失败：太卡、包太大、或一旋转就变成飞船 → 换更轻的画法，**同一份时间帧数据**，读者看到的字和按钮不变。

样片里也必须遵守：

- 相机锁死，正面看，不能拖着转
- 不要轨道旋转、不要驾驶舱、不要人物
- 数字和日期仍由网页管；Three.js 只负责把那一帧的点画亮
- 没有 3D 时，退回普通圆点，功能还在

WebGPU 不当第一道门槛。Three.js 若自带更好的后端，可以以后再开。

---

## 12. 和现站的关系（两套面，不是把 Cockpit 拆成两期）

GitStarClub 以后是两套阅读面，共用同一份 ≥10k 数据：

| 面 | 是什么 | 读者来干什么 |
|---|---|---|
| **静态页 = 现在的网站** | Pulse、榜单、repo/org、分类、Compare | 打开就能读、能引用、能被搜索引擎抓。几乎无客户端 JS |
| **动态数据舱 = Cockpit** | 新做的、可用鼠标在时间上走的星空 | 看天气、跟一个项目、拖轴倒带。Three.js 只活在这里 |

Cockpit **不替换** 现站。搜 `react star history` 进来的人仍落在 repo 页。Cockpit 是多一种「看开源怎么动」的入口。

现站的迭代继续走 [ROADMAP.md](./ROADMAP.md) 的 Track A / B / C，不因为 Cockpit 停掉。

Cockpit 现在**不是** Track A 实现流，也**不是** Track C（不扩白名单、不上查询引擎）。正式写进 Roadmap 要等：`pre` 上舱的样片过关，并且 Track C 在 2026-09-12 有结论，再开 epic 子 issue。样片只在 **`pre`**，**不进 `main`**，路由 `noindex`。

### 现站 Roadmap 怎么定

还是现在那张图：把现有 ≥10k 编年史和 Pulse 读深、读能引用。A1–A4 已在 `pre` 合完。新的现站点功能仍要挂在开放 epic 的子 issue 上，冻到 2026-09-12 的规则不变。

### 数据舱 Roadmap 怎么定

只回答一件事：**在 pre 上用鼠标来回拖时间轴，这片星值不值得成为一个入口。**

1. **样片（现在）** — 假数据 + Three.js + 可拖的轴。相机锁死。现站一条代码都不必为了它改阅读页。
2. **过关** — 拖到 2019，点明显变小/变暗；拖回今天，涨的点亮起来；点一颗有故事；不像飞船、不像散点图。光和深度不够就继续 Three.js。
3. **过关之后** — 才做真的预计算雷达包，才谈挂进导航、才谈和 Pulse 怎么链过去。
4. **不过关** — Cockpit 停在样片，现站照常发版。

两套面共用 lookup、榜、曲线、分类；舱多出来的只有「400 点时间帧」和 Three.js 岛。现站页面继续 RSC，不把 Three.js 带进 Pulse / 榜单 / repo 页。



