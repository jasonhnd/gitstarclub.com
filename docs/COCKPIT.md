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

# GitStar Cockpit — Content contract

> This document locks the screen from **what the reader is here to do**. A visual mock is only illustrative; when it conflicts with this document, this document wins.
>
> **Not an already-shipped route.** It does not authorize newly opening `/cockpit`, and it does not authorize bypassing [ROADMAP.md](./ROADMAP.md) Track C.
>
> Product tone and data honesty belong to [PRODUCT.md](./PRODUCT.md). Ranking definitions belong to [RANKING.md](./RANKING.md). Categories belong to [CATEGORIES.md](./CATEGORIES.md). Field shapes belong to [DATA-CONTRACTS.md](./DATA-CONTRACTS.md). Internal metric names (flow / stock) appear only in §9 of this document, and do not appear on the glass.

## Who the reader is, and what they came to do

The site already answers two things: [INFORMATION-ARCHITECTURE.md](./INFORMATION-ARCHITECTURE.md)'s Pulse (who is moving now) and Rankings (who is the largest, and who won which stretch). Cockpit does not invent a third set of rankings. It lets the same person **see the motion, and drag time back**.

The target readers are still the developers, tech media, and researchers of [PRODUCT.md](./PRODUCT.md) — they will search a project name, they will cite as-of, and they will not come to learn "flow / Momentum / p90".

Within **5 seconds** of opening, the following must hold:

1. The middle is a field of open-source projects that are moving, not a table.
2. One project has already been told through, with no need to click first.
3. One can see that what is being looked at now is "this month".
4. One can see that there is a timeline underneath that can be dragged; one pull of the mouse, and the field of dots in the middle changes with it.

Four reader tasks, by priority:

| Task | What the reader is thinking | How Cockpit answers |
|---|---|---|
| **Read the weather** | What has open source been gaining lately? | Radar + three headlines on the left + by default tell the one that gained the most |
| **Follow one project** | How did it grow to today? | After it is selected: the story column + its 10k/50k/100k on the timeline; drag to that day and see then |
| **Find neighbors** | Who else is of the same kind? | Three Nearby dots; Compare |
| **Rewind the world** | What did 2019 look like? And the day it broke 100k? | Drag back and forth with the mouse on the all-history axis; clicking a milestone jumps to that day |

A control that cannot do these four things does not enter the first version.

---

## What this version changed (relative to the previous lock)

The previous one started from data modules, and the reader had to learn our words first. This version is changed to the reader's words. On a conflict, this version wins.

| Old lock | New lock | Why |
|---|---|---|
| 5 items on the left, Rising / Accelerating / Persistent Growth / New Entrants / Category Movers | **3 headlines** on the left: Moving now / Speeding up / New on the map | Five side by side is a control room, not reading. At one time the reader looks only at "who is rising, who is accelerating, who just entered 10k stars" |
| Chips `1W 1M 1Y ALL` | The chips are only **This week / This month / This year**. The timeline is always all-history | On the time bar, `ALL` looks like "the whole history", but it actually changes "what counts as moving". Do not bind the two things to one key |
| An equivalent 7d / 30d / 1y + Momentum + Acceleration on the right | The story column's main sentence matches the current chip (This month +9.2k); "vs last month" is in plain language; do not use Very high | The same project has this month on the left and 7d on the right, and the reader will doubt which one is the real one |
| The timeline's main action is Play | **The main action is dragging the timeline back and forth with the mouse**. Play is only an optional auto-slide, not the reason this cabin exists | It is normal for the head to be on today when it opens; the reader drags left and can get back to 2019 |
| Persistent Growth as its own item | Remove it. If the selected project has risen for 3 months in a row, write one sentence in the story column | That is a property of this project, not a global headline |
| Category Movers as its own item | Remove it. A change in category place is written in the story column as `In AI / ML  #2  was #4` | The reader cares about "its place in its own category", not a fifth headline |

---

## Locked decisions

| Decision | Locked value |
|---|---|
| Open by default | This month; playhead = today; story = the project that gained the most stars this month |
| Meaning of "moving" | Decided by the chip: This week / This month / This year |
| Timeline range | Always from the earliest month in the data → today. There is no ALL key |
| Left headlines | 3 items, one repo each, rules in §3 |
| Story-column primary delta | **The same sentence as the chip** (This month / This week / This year) |
| Node size | Scale (today's stars; if history is dragged, the cumulative total then) |
| Node bright / tail | bright = rising in this window; tail = rising faster than the previous window |
| Node color | Domain; a legend of 5 groups: AI / Dev Tools / Database / Infra / Web |
| Radar foreground | Scale, or this window's gain, in about the top 400; the rest extremely faint |
| Language on the glass | English by default. Forbid flow, stock, Momentum, Acceleration, p90, and intel |
| How to draw the radar | **First use Three.js to make a starfield one can look at**. If it looks good, keep it; if it is too heavy or too much like a game, switch to a lighter way of drawing. The data frames do not change |

---

## 1. Top bar

The reader must recognize that this is GitStarClub, and be able to search a name they already know.

| What is on screen | What the reader gets |
|---|---|
| `★ GitStarClub` + `Cockpit` | Still inside this product, only switched into explore mode |
| `Explore how open source moves` | This sentence is the task |
| Search | Enter a known `owner/name`, select it in the radar, and do not kick it to the detail page first |
| Date | "Which day these numbers are counted through" — the same set as the site-wide as-of |

Language and theme are the same as the current site.

---

## 2. Radar (weather)

The reader should feel: each bright dot is a real project; a big one has more stars; a flashing one is one that is rising lately.

Hover says only plain language:

```text
huggingface/transformers
164.1k stars
+9.2k this month
```

At most about 6 names are printed on the chart (the ones that gained the most this window, the ones of extreme scale, and the one currently selected). Do not turn the chart into a tag cloud.

One click: the right side switches to this project's story, and the timeline underneath switches to its 10k / 50k / 100k. Do not allow an empty selection — on open it is already telling "the one that gained the most this month".

No zoom, and no roaming. To find a project one recognizes, use Search.

---

## 3. Left headlines (the titles of the weather)

Not a menu. Three items, always in this order, one project each.

| Title on the glass | What the reader hears it as | Rule (internal, see §9) |
|---|---|---|
| **Moving now** | The one that gained the most lately | Rank 1 by net stars added this window, and > 0 |
| **Speeding up** | Faster than the previous stretch | Net added this window > 0, and the one that gained the most more than the previous window |
| **New on the map** | Just entered the 10k-star universe | **First** crossed 10k in this window (a frozen milestone) |

Each item holds only:

- Title
- `owner/name`
- The star count now
- One delta sentence: `+9.2k this month` (it changes with the chip to week / year)
- One 90-day small curve (so a person feels the motion, and does not read the axes)

The corner mark of Speeding up may be the plain language `faster than last month`; do not let `+38%` fly alone on the title (a percentage has no base, and the reader will feel it is hollow).

Clicking one item = select this project. The list of three changes only with the chip, not with the selection. The selected item is highlighted lightly.

If some item has nobody this window: leave the title, and put `—` where the project would be. Do not keep last month's "newcomer" into this month.

---

## 4. Story on the right (follow one project)

The reader has just finished clicking (or is already looking, by default) at one project. This place answers only: how big it is now, how much it has gained lately, what place it has among its kind, who is nearby, and whether I can compare or read the full text.

English by default, and the structure is locked:

```text
huggingface/transformers
164.1k stars                    ← playhead moment; if it is not today, add as of 2019-07

This month          +9.2k       ← the same sentence as the chip
vs last month       faster      ← more than the previous window; if there is no previous window, then —
In AI / ML          #2  was #4  ← registry category name, forbid Local AI

Last 90 days        [curve]

Nearby              pytorch · diffusers · datasets

[Compare]  [Full history]
```

When the chip switches to This week / This year, the first line changes to `This week` / `This year`. Do not also lay out three blocks of 7d / 30d / 1y at the same time — that is a second clock.

The 90-day curve already gives "what the recent stretch looks like". If the reader wants a ten-year curve, go to Full history.

If this project has been rising for **3 calendar months in a row**, add one sentence `3rd month climbing` under `vs last month`. This is a property of the story, not a global headline.

Nearby: the existing related (same owner or same language, cut to 3 by scale). Clicking Nearby = switch to telling that project. Compare = take the current project to `/compare`. Full history = `/{owner}/{name}`.

---

## 5. Timeline (rewind)

This is the unique ability of the data cabin relative to the current site's lists: **walk back and forth in time with the mouse**. It is not pressing Play once and waiting for it to finish playing by itself.

The axis is always all-history. The head stops on today by default. The reader drags left, and that is going back to the past; drags right, and that is coming back to today. The dots in the middle, and the big number of the selected project, all move with the head.

| Reader action | What should happen |
|---|---|
| Hold the head on the axis and drag left or right | The radar immediately becomes **that time**: a dot's size is the scale then, and the bright ones are the ones rising in that window |
| Click blank space on the axis | The head jumps to that year/month |
| Click 10k / 50k / 100k | Jump to the day the selected project truly crossed it (a frozen milestone, not an estimate) |
| This week / This month / This year | It only changes "what counts as rising", and it does not shorten the axis. The axis is still all-history |
| Play (optional) | The head auto-slides along the axis. It may exist, and it is not the main path. When it is already on today, auto-slide should start from a point the reader can understand, or simply not offer auto-slide |
| `prefers-reduced-motion` | Do not auto-slide; drag and click are still available |

Event dots belong only to the **currently selected project**. Do not write a hand-filled release note such as "Ollama 0.3 release".

---

## 6. On open

1. Chip = This month.
2. Playhead = today.
3. Radar = the universe that is moving this month.
4. The three headlines = this month's Moving now / Speeding up / New on the map.
5. Story column = that Moving now project.
6. The dots on the axis = that project's 10k / 50k / 100k.

The concept picture may use `huggingface/transformers` as Moving now, so the name can be recognized. After it ships, it must be rank 1 by net added in that window, and it must not be hardcoded.

---

## 7. Interaction (reader paths)

Always telling one project.

**People who came for the weather:** they can look as soon as it opens. Click a headline or click the radar, and the right side switches to that project. Flip the chip to This week, and the three headlines switch to the week's. There is no need to learn any metric name.

**People who came with a name:** a Search hit selects it at once. Even if it is not among the 400 bright dots it must still be selectable, and be drawn into the foreground temporarily.

**People who want to see how it grew:** drag the timeline, or click 10k on the axis. The big number moves with that time. The story column's main sentence (This month +9.2k) **still says this window relative to today**, to avoid a false account such as "2019's this month"; only the big number and the radar scale travel through. `as of Jul 2019` appears beside the big number.

**People who want to find neighbors:** Nearby switches the selection; Compare leaves to overlay curves.

Click blank space on the radar: do not clear the selection.

Keyboard: ← → move the head by month/week; Home / End = earliest / today. Space is auto-slide only when Play is offered.

---

## 8. Forbidden on the glass

| Forbidden | What the reader would get |
|---|---|
| flow / stock / Momentum / Acceleration / intel / p90 | These are our words, not their task |
| An `ALL` key, a `3M` key | The timeline is already the whole thing; three months have no ranking |
| Writing 7d / 30d on the left, and writing This month again on the right | Two clocks |
| Very high / exploding / breakout | It is like scoring, not like stating |
| Invented category names | They will not match the category pages |
| More than five headlines side by side | One does not know which sentence to look at first |
| The timeline was dragged but the dots in the middle do not move | The unique ability dies |
| Projects outside the whitelist, fabricated 10k dates, LLM summaries | They break site-wide honesty |

Example numbers are not the contract. After it ships, use the real view of that as-of.

---

## 9. Internal mapping (not written on the glass)

For implementation cross-reference. The reader does not need to know these names.

| Glass | Internal |
|---|---|
| Scale / big-number stars | `current_stars`; historical month-end `curve.monthly.total_end` |
| This week / month / year's +k | The corresponding window's repo **flow** (net added; if it can be negative, that project does not enter Moving now) |
| faster / slower / — | `flow_t − flow_{t-1}`. A denominator floor of 100 is used only to order whether something is selected into Speeding up; the glass does not show a percentage by default |
| New on the map | The existing new ranking / frozen `crossed_10k` |
| In {label} #n was #m | The primary `domain`'s `rank` + `prev_rank`, and the label comes from the registry |
| 3rd month climbing | 3 calendar months in a row with flow > 0 |
| Bright | This window's flow > 0 |
| Tail | `flow_t > flow_{t-1}` |
| Color, 5 groups | `ai-ml` → AI; `devtools` → Dev Tools; `data-db` → Database; `infra-cloud` → Infra; `web-frontend`+`web-backend` → Web |
| Nearby | The existing related rules |
| 90-day curve | `curve.recent_daily` cumulative |

The existing growth-rate ranking (flow / period-start stock) still lives only on the ranking page, and does not enter the Cockpit glass.

---

## 10. Implementation boundary (this document does not authorize starting work)

A precomputed view may make a "400-dot radar pack" and "three headlines". Do not scan 5,300 entity files in the browser. Do not run the engine on the request path. Drill-down outside the whitelist, and arbitrary facets, still belong to Track C.

---

## 11. How to draw the radar (Three.js first)

Nobody has yet seen "what this field of stars looks like while dragging the timeline back and forth with the mouse". Before the effect is seen clearly, **do not turn off Three.js**.

The order is locked:

1. **First make a Three.js sample** (a starfield in the middle + a draggable timeline; the left and right columns may use a static shell). The purpose is to see whether, while dragging, the light, the tails, and the depth can keep up. It is not making a game, and it is not making an auto-player.
2. The sample passes: while dragging the axis the dots are changing, like the concept picture rather than an Excel scatter plot → **keep Three.js**, load it dynamically, and download it only when the data cabin is opened.
3. The sample fails: too laggy, the bundle too big, or one rotation and it becomes a spaceship → switch to a lighter way of drawing, with **the same time-frame data**, and the words and buttons the reader sees do not change.

The sample must also obey:

- The camera is locked, viewed from the front, and cannot be dragged around to rotate
- No orbit rotation, no cockpit, and no characters
- Numbers and dates are still owned by the web page; Three.js is only responsible for painting that frame's dots bright
- When there is no 3D, fall back to ordinary round dots, and the function is still there

WebGPU is not the first threshold. If Three.js brings its own better backend, it may be turned on later.

---

## 12. Relationship with the current site (two surfaces, not splitting Cockpit into two phases)

GitStarClub will from then on be two reading surfaces, sharing the same copy of ≥10k data:

| Surface | What it is | What the reader came to do |
|---|---|---|
| **Static pages = the website now** | Pulse, rankings, repo/org, categories, Compare | It can be read as soon as it opens, it can be cited, and it can be crawled by a search engine. Almost no client JS |
| **Dynamic data cabin = Cockpit** | Newly made, a starfield one can walk through in time with the mouse | Read the weather, follow one project, drag the axis to rewind. Three.js lives only here |

Cockpit **does not replace** the current site. A person who comes in by searching `react star history` still lands on the repo page. Cockpit is one more entrance for "watching how open source moves".

Iteration of the current site continues along [ROADMAP.md](./ROADMAP.md)'s Track A / B / C, and does not stop because of Cockpit.

Cockpit **is not** now a Track A implementation stream, and it **is not** Track C (do not expand the whitelist, and do not put a query engine up). Writing it into the Roadmap for real waits for: the sample of the cabin on `pre` to pass, and for Track C to have a conclusion on 2026-09-12, and then an epic sub-issue is opened. The sample lives only on **`pre`**, it **does not enter `main`**, and the route is `noindex`.

### How the current site's Roadmap is decided

It is still that same picture: read the existing ≥10k chronicle and Pulse deeply, and read them so they can be cited. A1–A4 are already merged on `pre`. A new current-site feature must still hang on the open epic's sub-issue, and the rule frozen until 2026-09-12 does not change.

### How the data cabin's Roadmap is decided

It answers only one thing: **on pre, dragging the timeline back and forth with the mouse, is this field of stars worth becoming an entrance.**

1. **Sample (now)** — fake data + Three.js + a draggable axis. The camera is locked. The current site does not have to change a single line of reading-page code for it.
2. **Pass** — drag to 2019, and the dots clearly get smaller/dimmer; drag back to today, and the rising dots light up; click one and there is a story; it does not look like a spaceship, and it does not look like a scatter plot. If the light and the depth are not enough, continue with Three.js.
3. **After it passes** — only then make a real precomputed radar pack, only then talk about hanging it in the navigation, and only then talk about how to link onward with Pulse.
4. **If it does not pass** — Cockpit stays at the sample, and the current site ships as usual.

The two surfaces share lookup, rankings, curves, and categories; what the cabin adds is only "400-dot time frames" and the Three.js island. Current-site pages stay RSC, and do not bring Three.js into Pulse / ranking / repo pages.



