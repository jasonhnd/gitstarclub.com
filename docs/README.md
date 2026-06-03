# gitstarclub 文档索引

> 一本可浏览的 GitHub 开源编年史。运行时**纯静态只读** JSON / Vercel Blob、零运行时数据库；生产数据生命周期由 **Vercel Workflow** 每周 cron 自动承载（Phase 2–5 已线上验证）。本页是 `docs/` 的导航入口：**阅读顺序** + **每篇职责** + **单一真相源归属图**。项目总览见根 [../README.md](../README.md)。

## 阅读顺序（新人按此走一遍）

1. [REQUIREMENTS.md](./REQUIREMENTS.md) — 需求与范围基准（任何设计变更先回这里对齐）
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — 技术栈、数据流、数据模型、扛量、页面分层
3. [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md) — Vercel-only 数据生命周期（L1–L4、Workflow、Phase 0–5、发布/回滚/GC）
4. [DATA-CONTRACTS.md](./DATA-CONTRACTS.md) — 每个产物的 Zod schema（构建侧类型唯一事实源）
5. [PIPELINE.md](./PIPELINE.md) — 管线阶段（bootstrap + live cron + L3 workflow + 折叠老化）
6. [RANKING.md](./RANKING.md) — 排名口径（seam 边界、stock 锚定、flow/stock、growth/new）
7. [FRONTEND.md](./FRONTEND.md) — 路由、渲染分层（option C）、i18n 实现、组件、数据消费
8. [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) — 设计令牌、配色、组件模式（视觉/交互唯一真相源）
9. [SEO.md](./SEO.md) — sitemap、meta、结构化数据、OG、robots、多语 SEO
10. [OPS.md](./OPS.md) — 运维 runbook：Blob 布局、cron 调度、监控/告警、部署/回滚
11. [TESTING.md](./TESTING.md) — 测试策略 + workflow 闸门 + 测试套件
12. [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) — 构建顺序 M0–M5 + 里程碑进度

**卫星文档**（按需）：[V0.2-DESIGN.md](./V0.2-DESIGN.md)（v0.2/v0.3 设计蓝图）· [PRODUCT.md](./PRODUCT.md)（产品/页面/调性）· [INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md)（UX 导航叙事 / reader's map，英文）。

## 每篇职责一览

| 文档 | 职责 |
|---|---|
| REQUIREMENTS | 需求基准、范围、约束；**repo/视图计数口径**的单一源 |
| ARCHITECTURE | 技术栈、数据流、数据模型（逻辑层）、扛量、页面分层、演进路线 |
| VERCEL-DATA-OPERATIONS | 生产数据生命周期；**Workflow 步骤枚举**与发布/回滚/GC 机制 |
| DATA-CONTRACTS | canonical shard + 视图 + workflow/指针的 **Zod schema**（类型唯一事实源） |
| PIPELINE | 数据管线各阶段与算法、幂等性 |
| RANKING | **排名/stock 锚定/seam** 口径（算法唯一真相源） |
| FRONTEND | **路由/页面清单**、**渲染模型 / option C**、i18n 实现、组件 |
| DESIGN-SYSTEM | **配色 / 设计令牌 / 组件模式**（视觉唯一真相源） |
| SEO | sitemap/meta/JSON-LD/OG/robots、**i18n 多语 SEO 口径** |
| OPS | **Blob 物理布局**、**cron 调度**、监控/告警、部署拓扑、回滚 runbook |
| TESTING | 测试金字塔、数据质量闸门、workflow 发布闸门、套件清单 |
| IMPLEMENTATION-PLAN | **里程碑路线图**（状态-of-record） |
| V0.2-DESIGN | **v0.2/v0.3 范围与设计**（搜索✅ / 叙事 / 拐点 / 分享卡片 / v0.3 DB 阻塞点） |
| PRODUCT | 产品定位、页面用途/布局、调性、命名 |
| INFORMATION-ARCHITECTURE | UX 导航叙事（reader's map）；路由清单以 FRONTEND §1.1 为准 |

## 单一真相源归属图（避免重复漂移）

同一主题只在一处定义，其余文档**指针引用**，不重述：

| 主题 | 唯一归属 |
|---|---|
| repo / 视图计数 | **REQUIREMENTS** |
| 产物 schema（字段级） | **DATA-CONTRACTS** |
| Blob 物理树 | **OPS** §Blob 布局 |
| Cron 调度 | **OPS** §Cron |
| Workflow 步骤枚举 | **VERCEL-DATA-OPERATIONS** §3.4（manifest 8 步分组见 DATA-CONTRACTS §2.12） |
| 渲染模型 / option C | **FRONTEND** §2.5 |
| 路由 / 页面清单 | **FRONTEND** §1.1 |
| i18n 模型 | **SEO** §10（实现细节 FRONTEND §7） |
| 配色 / 设计令牌 | **DESIGN-SYSTEM** |
| 排名口径 / seam / stock 锚定 | **RANKING** §3 |
| 里程碑路线图 | **IMPLEMENTATION-PLAN** |
| v0.2 / v0.3 范围 | **V0.2-DESIGN** |

## 当前状态（2026-06-03）

- **v0.1 MVP + Vercel-only 数据生命周期 Phase 2–5**：✅ 已上线 / 线上验证（`status=published`）。
- **v0.2 叙事与发现**：全站搜索 ✅ 已上线；拐点检测 / 分享卡片补全 / LLM 月度叙事 ⏳ 待做。
- **v0.3 下钻 / 对比 / 聚类 / 语义检索**：📋 仅设计，阻塞于一次 DB 选型决策（见 V0.2-DESIGN §5）。
- **发布前关口**：noindex → 上线切换（`SITE_INDEXABLE=1`）+ CWV / 收录核对（见 SEO）。
