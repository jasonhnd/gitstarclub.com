---
version: alpha
name: GitStarClub
description: >-
  A quiet, print-like almanac of GitHub stars. Graphite surfaces, one amber
  accent, Material 3 color roles seeded from #F2A900. Translated 1:1 from the
  locked baseline in docs/DESIGN-SYSTEM.md (commit 689605c); this file adds no
  new visual values.
colors:
  primary: "#7f5700"
  on-primary: "#ffffff"
  primary-container: "#f2a900"
  on-primary-container: "#614200"
  primary-fixed-dim: "#ffba3b"
  on-primary-fixed: "#281900"
  secondary: "#785923"
  on-secondary: "#ffffff"
  secondary-container: "#ffd391"
  on-secondary-container: "#795a23"
  tertiary: "#00668a"
  on-tertiary: "#ffffff"
  tertiary-container: "#3fc3ff"
  on-tertiary-container: "#004e6b"
  background: "#fbfbfd"
  on-background: "#1a1c1e"
  surface: "#fbfbfd"
  on-surface: "#1a1c1e"
  surface-variant: "#dfe2eb"
  on-surface-variant: "#43474e"
  surface-dim: "#dadce0"
  surface-bright: "#fbfbfd"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#f5f5f8"
  surface-container: "#efeff2"
  surface-container-high: "#e9e9ed"
  surface-container-highest: "#e3e3e7"
  outline: "#73777f"
  outline-variant: "#c3c7cf"
  inverse-surface: "#2f3033"
  inverse-on-surface: "#f1f0f4"
  chart-cat-1: "#b8860b"
  chart-cat-2: "#00668a"
  chart-cat-3: "#7c3aed"
  chart-cat-4: "#15803d"
  chart-cat-5: "#be123c"
  dark-primary: "#ffca74"
  dark-on-primary: "#432c00"
  dark-secondary: "#eac080"
  dark-on-secondary: "#432c00"
  dark-secondary-container: "#5e420c"
  dark-on-secondary-container: "#d7af70"
  dark-tertiary: "#9edaff"
  dark-on-tertiary: "#00344a"
  dark-background: "#121316"
  dark-on-background: "#e3e2e6"
  dark-surface: "#121316"
  dark-on-surface: "#e3e2e6"
  dark-surface-variant: "#43474e"
  dark-on-surface-variant: "#c3c7cf"
  dark-surface-dim: "#121316"
  dark-surface-bright: "#38393c"
  dark-surface-container-lowest: "#0d0e11"
  dark-surface-container-low: "#1a1c1e"
  dark-surface-container: "#1e2022"
  dark-surface-container-high: "#282a2d"
  dark-surface-container-highest: "#333538"
  dark-outline: "#8d9199"
  dark-outline-variant: "#43474e"
  dark-inverse-surface: "#e3e2e6"
  dark-inverse-on-surface: "#2f3033"
  dark-chart-cat-1: "#ffca74"
  dark-chart-cat-2: "#9edaff"
  dark-chart-cat-3: "#a78bfa"
  dark-chart-cat-4: "#4ade80"
  dark-chart-cat-5: "#fb7185"
typography:
  body:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    lineHeight: 1.55
  wordmark:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.15rem
    fontWeight: 800
  nav-link:
    fontFamily: Geist Mono
    fontSize: 0.8rem
  tag:
    fontFamily: Geist Mono
    fontSize: 0.7rem
    fontWeight: 600
rounded:
  highlight: 12px
  full: 9999px
spacing:
  logo-gap: 8px
  nav-gap-x: 12px
  nav-gap-x-sm: 16px
  nav-gap-y: 8px
  chrome-gap: 16px
  chrome-bottom: 0.85rem
  gutter-min: 1.25rem
  gutter-max: 2.5rem
  tag-x: 8px
  tag-y: 2px
components:
  app-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
  app-bar-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-on-surface}"
  wordmark:
    textColor: "{colors.on-surface}"
    typography: "{typography.wordmark}"
  nav-link:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.nav-link}"
  nav-link-hover:
    textColor: "{colors.on-surface}"
  chrome-tag:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    typography: "{typography.tag}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  readable-gold-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-primary-container}"
  readable-gold-text-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.primary-fixed-dim}"
  highlight:
    rounded: "{rounded.highlight}"
    padding: 0.02em 0.22em
---

## Overview

GitStarClub reads like a printed almanac of GitHub stars: calm graphite
surfaces, dense tabular data, and a single amber accent that marks "stars".
The site is mostly server-rendered with no tracking and no AI-generated
content, so the visual language stays quiet and editorial, never "dashboard
neon".

This file is the agent-readable copy of `docs/DESIGN-SYSTEM.md`, which stays
the locked source of truth. Both must change in the same commit, under the
lock procedure in that document (design issue → maintainer approval → PR with
before/after evidence). If the two ever disagree, `docs/DESIGN-SYSTEM.md` and
`web/app/globals.css` win.

## Colors

Material 3 color roles generated from the amber seed `#F2A900`
(SchemeFidelity). Light values are the plain tokens; dark values carry a
`dark-` prefix and apply to both `prefers-color-scheme: dark` and
`[data-theme="dark"]`. Tokens without a `dark-` twin
(`primary-container`, `on-primary-container`, `tertiary-container`,
`on-tertiary-container`, `primary-fixed-dim`, `on-primary-fixed`) are the same
in both themes. Shadows use black (`--md-shadow-rgb: 0 0 0`) in both themes.

- **Primary-fixed-dim (#ffba3b):** brand gold for star marks, chart accents,
  heatmap fills and dark-mode emphasis. It is **not** readable text on the
  light surface.
- **Readable gold text:** use the `.text-readable-gold` class — light theme
  resolves to `on-primary-container (#614200)`, dark theme to
  `primary-fixed-dim (#ffba3b)`. Never use `text-primary-fixed-dim` for text.
- **Primary-container (#f2a900) + on-primary-container (#614200):** the tag
  pair. It is only just above WCAG AA, so never lower the text with opacity.
- **Chart categories 1–5:** amber, blue, violet, green, rose; dark variants
  are lighter tints of the same hues.

## Typography

Two families, loaded in `web/app/_shell/RootShell.tsx`:

- **Plus Jakarta Sans** (`--font-sans`): all body and headings. Body line
  height 1.55, antialiased, `optimizeLegibility`.
- **Geist Mono** (`--font-mono`): navigation, tags, numbers and code-like
  labels.

There is no global type scale; component sizes are Tailwind utilities. The
top bar sizes are locked: wordmark 1.15rem extrabold, star mark 1.05em, nav
links 0.8rem, tag 0.7rem semibold.

## Layout

No global spacing scale. Locked spacing lives in the top bar
(`web/app/_explore/Chrome.tsx`): horizontal gutter
`clamp(1.25rem, 5vw, 2.5rem)`, bottom padding 0.85rem, main gap 16px, nav gaps
12px / 8px (16px horizontal from `sm`), logo gap 8px. Safe-area insets are
respected at the top (`max(0.85rem, env(safe-area-inset-top))`) and bottom.
Mobile wraps the bar into two rows for 44px touch targets.

## Elevation & Depth

Only two shadows, both Material-style:

- `--elev-1`: `0 1px 2px rgb(0 0 0 / .3), 0 1px 3px 1px rgb(0 0 0 / .12)`
- `--elev-2`: `0 1px 2px rgb(0 0 0 / .3), 0 2px 6px 2px rgb(0 0 0 / .14)`

The top bar uses translucency instead of shadow: `surface` at 70% with
`backdrop-blur-lg backdrop-saturate-150` and a bottom `outline-variant` border.

Motion: `--ease-emphasized: cubic-bezier(0.2, 0, 0, 1)` plus a CSS `linear()`
spring. Animations `rise` 0.62s, `pop` 0.9s, `status-pulse` 2.4s,
`page-enter` 0.42s. Under `prefers-reduced-motion: reduce` all animation and
transition is off, and chart bars/curves show their end state.

## Shapes

No global radius scale. The highlight primitive `.hl` is 12px; the top-bar tag
is fully rounded. Any other radius belongs to the component's own utilities.

## Components

- **app-bar:** sticky, `z-20`, translucent surface, bottom hairline. Holds the
  wordmark, nav, `SearchBox`, `LanguageSwitcher`, `ThemeToggle` (the three
  controls are the only client islands).
- **nav-link:** mono 0.8rem, `on-surface-variant`, hover to `on-surface`.
  Pulse and Rankings show from `sm`, Categories from `md`, Compare and About
  from `sm`; below `sm` they move into a pure-HTML `<details>` menu.
- **chrome-tag:** amber pill (`primary-container` / `on-primary-container`).
- **readable-gold-text:** gold emphasis that stays readable in both themes.
- **highlight:** `.hl` marker, 12px radius, tight padding.

## Do's and Don'ts

- Do keep amber as the only accent; blue/violet/green/rose appear only in
  charts.
- Do keep focus-visible rings, skip link, keyboard reach, ARIA labels and
  semantic markup.
- Don't add pure-white surfaces, darker amber emphasis, a new type scale or
  new spacing tokens without a new approved design issue.
- Don't put gold text on light surfaces with `primary-fixed-dim`.
- Don't add trackers, analytics or decorative client JavaScript to make the
  page feel "alive".
