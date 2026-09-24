---
owner: product
status: active
last_reviewed: 2026-07-06
source_of_truth_for:
  - product framing
  - page surfaces
  - tone
  - data-honesty posture
  - i18n posture
---

# gitstarclub product design

> This document defines the product's pages, information architecture, URLs, and visual tone. Architecture and the data layer are in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Scope

This document describes the **product itself** — what gitstarclub is, who it is for, what each page carries, tone, the data-honesty stance, and the i18n stance. Read this before changing the product. Version/stage/status belong to engineering progress, and are not covered here. Capabilities currently out of scope are in [ROADMAP.md](./ROADMAP.md).

## Requirement ID crosswalk

The single source of stable requirement IDs is [REQUIREMENTS.md §0](./REQUIREMENTS.md#0-requirement-ids--priority--traceability-matrix). This product document only records how pages/experience carry these IDs; acceptance criteria still return to REQUIREMENTS `P0-AC*` and the test documentation.

| Requirement ID | Product surface | Priority | Product responsibility |
|---|---|---|---|
| `REQ-CHRONICLE-001` | Home, year/month/week rankings, repo/org pages, all-time ranking | P0 | Provide a chronicle reading experience that can be looked back on, internally linked, and marked as-of. |
| `REQ-PULSE-001` | Home "rising now" section, `/pulse` | P0 | Present today's/this week's movers, revival/spike, and daily-refresh semantics. |
| `REQ-RANKING-001` | Year/month/week/all-time rankings and derived rankings | P0 | Make repo/org, flow/stock, and growth/new ranking semantics clearly comparable on the page. |
| `REQ-I18N-001` | English unprefixed URLs; ja/zh/zh-TW/ko/es/fr prefixed URLs | P0 | Localize chrome, metadata, and SEO links, while keeping repo data fields in the original text. |
| `REQ-DATAOPS-001` | Data honesty, freshness, as-of/daily-refresh notes | P0 | Pages express only published data state, and do not imply a live fetch or a prediction at request time. |
| `REQ-PERF-001` | Static content pages, low JS, a CDN-cacheable reading experience | P0 | The product experience must not depend on the client redrawing body text or on request-path data computation. |
| `REQ-SEARCH-001` | Top-bar search and search-result "+compare" | P1 | Provide a discovery entry that jumps straight by name and enters compare from search. |
| `REQ-COMPARE-001` | `/compare?repos=...` | P1 | Use a shareable URL to express multi-repo curve comparison state. |
| `REQ-CATEGORY-001` | `/categories` and category drill-down | P1 | Support discovering ranked repos by dimensions such as ecosystem/language/domain. |

## Product positioning

gitstarclub is a **chronicle of the open-source world + a real-time pulse** — a two-sided site tracking about 5,302 ≥10k star projects across a 12-year timeline:

- **Chronicle side**(year/month/week/repo/org/all-time ranking): look back at history, content is mostly frozen snapshots, marked "as of date".
- **Pulse side**(`/pulse` + home "rising now" section): refreshed daily, showing who is rising, and old-project revival/spike.

**Target users**: developers, tech media, and researchers interested in the open-source ecosystem — people who want to "browse by time" or "see what is happening now" rather than only look up a single repo.

**Data honesty**: the site does not fabricate, does not predict, and does not emotionalize. Every chart and every ranking is based on an explicit definition (see [RANKING.md](./RANKING.md)). Frozen periods are marked with a snapshot date, and active periods are marked "refreshed daily".

## Tone

**Material 3 Expressive (M3E)** — the design language of 2025 / Android 17: vivid dynamic color, an expressive type hierarchy, rounded shapes, spring motion, tonal elevation, and frosted-glass texture.

Differentiation no longer relies on "paper feel", but on a **cool graphite-gray neutral base + gold "star" accent + expressive motion**: gold is reserved for "star / peak" semantics, and surface uses cool neutral graphite gray (explicitly avoiding warm beige — that is the look of the Claude website). It is still different at a glance among the crowd of dark geek dashboards, and premium. Light and dark modes (system preference + manual toggle).

### Fonts

| Use | Font |
|---|---|
| Headings / body | **Plus Jakarta Sans** (geometric variable sans-serif) |
| Numbers / repo names | **Geist Mono** |

- Headings follow M3 Display/Headline: large size + heavy weight (700–800), negative tracking, expressing M3E "strong hierarchy, immediacy"
- Body uses the same family at 400/500; the whole site uses at most two families (sans-serif + monospace), within the performance budget

### Color (accent = amber gold `#F2A900`; surface = cool neutral graphite gray)

**Gold is used only as accent ("star" color)**: primary / primary-container / primary-fixed-dim are M3 tokens hand-tuned from the amber-gold reference color and written in `web/app/globals.css`. **surface is decoupled from Claude warm beige** — switched to the M3 baseline cool neutral gray (with a very slight cool tint), and is not stained warm by the gold seed. Full sys color roles (including 5-level surface-container, fixed roles, and both light and dark sets).

> Note: in M3, `primary` (tone 40) is a **dark** text role, and **bright amber is on `primary-container`**; "bright gold" decoration (star, peak) uses `primary-fixed-dim`; surface / outline / inverse use the M3 baseline cool neutral gray (decoupled from the seed, avoiding warm staining → not colliding with Claude).
> **The full palette (role × Light/Dark × use, both light and dark, all roles) is in [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).**

### Texture

- **tonal elevation**: use the 5 levels of `surface-container` + M3 shadow to express height (replacing the old "hairline only, no shadow")
- **Rounded shapes**: M3 shape scale (4 / 8 / 12 / 16 / 28 / full), pill and squircle
- **Frosted glass**: the top bar / overlays use `backdrop-filter` translucency (the signature M3E texture)
- **Spring motion**: CSS `linear()` encodes the spring curve + `cubic-bezier(0.2,0,0,1)` emphasized easing; **content pages still have zero client JS**, and motion is pure CSS; cross-document **View Transitions** do container-transform page transitions
- Respect `prefers-reduced-motion`

> Drop paper feel / serif, and drop warm beige (avoid the Claude look). M3 Expressive: **graphite gray + star gold**, vivid dynamic premium, light and dark modes.

## URL structure

> The table below gives **use ↔ URL**; the authoritative route↔file↔render-layer inventory is in [FRONTEND.md](./FRONTEND.md) §1.1.

| Use | URL |
|---|---|
| Home | `/` |
| Year page | `/rankings/2024` |
| Month page | `/rankings/2024/10` |
| **Week page** | `/rankings/2024/W42` (standalone page, ISO week) |
| Repo detail page | `/:owner/:name` |
| **Org detail page** | `/o/:login` |
| **All-time ranking** | `/rankings` |
| **Pulse page** | `/pulse` (today/this week's big rises + revival/spike) |
| **Compare page** | `/compare?repos=a/b,c/d` (multi-repo overlaid chart; the URL is the state and is shareable) |
| About page | `/about` |

Principle: **shortest, readable, SEO-friendly**. English keeps unprefixed URLs; ja/zh/zh-TW/ko/es/fr use locale-prefixed URLs, and point at each other through canonical / `hreflang` / `x-default` (see "Multilingual" below and [SEO.md](./SEO.md) §10).

## Core pages (chronicle + pulse, two sides)

> **Chronicle side**: home/year/month/week/repo/org/all-time ranking — look back, mostly frozen / marked "as of date". **Pulse side**: `/pulse` + the home "rising now" section — refreshed daily, "who is rising / old projects revive" (freshness model in [REQUIREMENTS §6](./REQUIREMENTS.md)).

### 1. Home `/`

**Goal**: as the Pulse home, show at a glance the projects currently changing in the open-source world, and direct visitors to this week, this month, the all-time ranking, repo, org, and category long-tail pages.

**Layout (top to bottom)**:

1. A Pulse title and a one-liner explaining the open-source projects changing this week, this month, and this year.
2. **Projects rising this month**: the current month's flow ranking, linking directly to repo detail pages.
3. **On this day in history / revived projects**: read that day's related projects from the hot snapshot, as a look-back entry.
4. Navigation and search take the user to `/pulse`, `/rankings`, `/categories`, `/compare`, repo detail pages, and org detail pages.
5. Home and `/pulse` share `PulseView`; home additionally emits `WebSite` JSON-LD, and `/pulse` is a standalone CollectionPage.

### 2. Year page `/rankings/2024`

**Goal**: at the scale of a year, look back at "that year's thread through the open-source world".

**Layout**:

1. Year title
2. **12 month cells** (heatmap style, 3×4 or 1×12)
   - Color depth = that month's newly added star volume
   - Click to enter the month page
3. Year TOP 50 ranking
4. Year's new members (repos that first cross 10k)
5. Previous/next year navigation `← 2023 | 2025 →`

### 3. Month page `/rankings/2024/10`

**Goal**: see, on one page, "what happened in the open-source world that month".

**Layout**:

1. Title + previous/next month navigation (always at the top)
2. A one-sentence summary ("This month: about 5,302 projects added 2.3M star in total · 47 new members")
3. **That month's calendar heatmap** (31 days, to see whether there is a spike day)
4. **Rankings (repo and org side by side)**:
   - 🔥 **This month's newly added TOP** (flow) · **This month's total TOP** (stock) — repo dimension
   - 🏢 **This month's org ranking** (flow / stock) — organization dimension (click org → `/o/:login`)
   - 🚀 **This month's growth-rate TOP** (flow ÷ month-start stock, floor ≥ 20k)
   - 🎂 **New members this month** (stock first crosses 10k)
5. **Previous/next month comparison**: projects that entered / dropped out of TOP 50
6. Internal links: every repo in the ranking → repo detail page

### 4. Repo detail page `/:owner/:name`

**Goal**: see a project's whole "life".

**Layout**:

1. Title: `owner / name` + a one-line description + current star
2. Meta strip: **primary language + language composition** (chips by language share %, linking to `/categories/language/<slug>`), created time, last sync time
3. **Full-history star curve**, marking key milestones
4. **Key milestone list**: created, first entered the ranking, **one tier every 50k** (50k / 100k / 150k …), current
   - Each milestone → links to the corresponding month page
5. **Monthly performance table**: stars added over the last N months + that month's rank
   - Every row of the month column is a link to the month page
6. Meta: topics, GitHub external link

### 5. Week page `/rankings/2024/W42` (standalone)

- That week's repo / org gain TOP + the site's weekly total; previous/next week navigation (ISO week).
- The current week is a "live" page (refreshed daily); past weeks are frozen.

### 6. Org detail page `/o/:login`

- org combined star curve (member aggregate) + current total (as-of).
- Member repo list (each one's stars) + the org's rank history in each period.
- Both User and Organization have a page.

### 7. All-time ranking `/rankings`

- Current total TOP: **repo ranking + org ranking** (stock descending). An overview of "who is largest", refreshed daily.

### 8. Pulse page `/pulse` (rising right now)

- Today / this week **gain TOP** + **revival/spike** (an old project suddenly explodes).
- Refreshed daily; it is where "latest activity" lands (the decision definition is in [REQUIREMENTS §6](./REQUIREMENTS.md)).

### Discovery entry: site-wide search

- **Navbar search box** (top-bar chrome), covering **all tracked repos** — a "jump by name" discovery entry, complementary to "browse by time" (year/month/week).
- **Client-side instant search**: MiniSearch lazy-loads versioned `search/index.json` on first focus (via CDN); prefix + fuzzy typo tolerance, weighted by stars; results go directly to `/{owner}/{name}`. **Zero runtime backend** — there is no `/search?q=` results page.
- **Each search result has a "+compare" checkbox**: after several are checked, a "Compare N →" button appears at the bottom and jumps to `/compare?repos=...`, and together with the navbar compare entry and the repo-page "Add to compare" button these form the compare tool's three entries.

### Compare tool: `/compare`

- **Goal**: overlay the star curves of indexed repos (≥10,000 stars) **on one chart** to compare growth.
- **The URL is the state**: `/compare?repos=facebook/react,vuejs/vue` reproduces the selection directly, and the link is shareable. Limit of 5.
- **Two normalizations**: absolute (cumulative stars sharing a y-axis) and "aligned to 10k" (the x-axis becomes the Nth month after each one crossed 10k, and what is compared is the growth trajectory).
- **Three entries**: the navbar link, the repo-page "Add to compare" button, and the search-box multi-select CTA (see above).
- **Current scope**: multi-repo compare is in scope, but only for indexed ≥10,000-star repos; repos outside the index and the low-star long tail cannot be selected.
- **Out of scope**: comparing arbitrary GitHub repos, ≥100-star long-tail drill-down, and out-of-index compare that needs database/query-layer support are future work (see [ROADMAP.md](./ROADMAP.md)).

## Ranking matrix and ranking definitions

> The full matrix **{week/month/year/all-time} × {repo/org} × {flow new adds / stock total}** — definitions, stock anchoring, and boundaries are in [RANKING.md](./RANKING.md). Below are the derived rankings commonly used on pages:

| Ranking | Definition | Bias |
|---|---|---|
| This month's newly added star TOP | This month's flow (∑delta) descending | Already-famous large projects |
| This month's growth-rate TOP | `this month's new adds / month-start total` descending; eligible only when **month-start total ≥ 20,000** | Established projects that still accelerate |
| New members this month | This month's cumulative (stock) first reaches ≥ 10000 | New blood |

> The reason for the growth-rate ranking floor (month-start ≥ 20k), the dedupe rules (new members do not enter growth rate), and other definitions are in [RANKING.md](./RANKING.md) §4.

## Repo identity and renames

- The primary key is the GitHub repo **id** (immutable); the URL uses the current `owner/name`
- Repo rename/transfer: `full_name` is passively updated when the whitelist refreshes weekly, and the old URL does a **308** permanent redirect (the repo route uses the accumulated alias table `lookup/aliases.json`; see [FRONTEND.md](./FRONTEND.md))
- Rename history is the union, produced by the `build aliases` step, of every retained `renames.json` increment (gc does not delete `ops/`); no extra tracking is required

## Multilingual (i18n)

Tone: English by default, with priority **English > Japanese > Chinese >** zh-TW / ko / es / fr, seven UI languages; English URLs stay unprefixed, and non-default locale URL / metadata / sitemap / language-switcher navigation have already landed per [I18N.md](./I18N.md). Data fields such as repo name, description, language, topic, and numbers are not translated. The product feature names **GitStarClub Pulse** and **GitStarClub Compare** are brand names and are not translated. **The authoritative definition is in [SEO.md](./SEO.md) §10, and the implementation is in [FRONTEND.md](./FRONTEND.md) §7.**

## Project naming

The project name is **gitstarclub**, and the domain is **gitstarclub.com** (already purchased).

## Visual / interaction details

- **Always show previous/next month/year navigation** — strengthens the sense of "browsing"
- **A repo name inside a ranking = an internal link**; a change in star count = visual weight; language = a weak label
- **Milestone links** = anchors on the month page, forming a mesh of internal circulation
- **Timestamps are shown as both UTC + JST** (the JA locale leads with JST); date-grain data is by UTC day
- **Site-wide search**: see "Discovery entry: site-wide search" above.

## Out of scope

Capabilities currently out of scope (arbitrary GitHub repo compare, ≥100-star long-tail expansion, a user system, dataset expansion, automatic narrative/OG cards, topic clustering, and so on) are in [ROADMAP.md](./ROADMAP.md).
