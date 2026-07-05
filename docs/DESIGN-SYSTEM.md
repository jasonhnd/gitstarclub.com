---
owner: design system
status: active
last_reviewed: 2026-07-06
source_of_truth_for:
  - visual baseline
  - design tokens
  - typography
  - chrome appearance
  - accessibility notes
---

# Design System Baseline

## Scope

This document is the locked source of truth for GitStarClub visual tokens and
Chrome appearance. The baseline is commit `689605c`, specifically:

```bash
git show 689605c:web/app/globals.css
```

The Chrome top bar notes also reference the same commit's
`web/app/_explore/Chrome.tsx`, because the top bar combines global CSS tokens
with Tailwind utility classes in that component.

This document records the baseline; it does not authorize visual changes.

## Lock Semantics

The values in this document are locked. Any change to palette, chart colors,
Tailwind theme color mappings, typography, spacing, radius, elevation, motion,
top chrome, or visible component appearance requires:

1. A new design issue.
2. Maintainer approval of the proposed design document.
3. A PR that updates this document in the same commit as the implementation.
4. Before/after visual evidence for affected routes and breakpoints.

The visual guardrail process is defined in [WORKFLOW.md](./WORKFLOW.md).

The non-visual accessibility behavior from #27 is retained: visible
`focus-visible` treatment, skip-link reachability, keyboard reachability, ARIA
labels, and semantic markup remain valid when they preserve the locked visual
baseline.

The visual changes from #27 and #28 are not part of this baseline. Pure white
surface changes, darker amber emphasis, new typography scale, and new spacing
that alter the look and feel must be reverted or reintroduced only through a new
approved design issue.

## Palette

The dark values below apply to both the automatic dark media query and the
explicit `[data-theme="dark"]` override.

### Material Color Tokens

| Token | Light | Dark |
|---|---:|---:|
| `--md-sys-color-primary` | `#7f5700` | `#ffca74` |
| `--md-sys-color-on-primary` | `#ffffff` | `#432c00` |
| `--md-sys-color-primary-container` | `#f2a900` | `#f2a900` |
| `--md-sys-color-on-primary-container` | `#614200` | `#614200` |
| `--md-sys-color-secondary` | `#785923` | `#eac080` |
| `--md-sys-color-on-secondary` | `#ffffff` | `#432c00` |
| `--md-sys-color-secondary-container` | `#ffd391` | `#5e420c` |
| `--md-sys-color-on-secondary-container` | `#795a23` | `#d7af70` |
| `--md-sys-color-tertiary` | `#00668a` | `#9edaff` |
| `--md-sys-color-on-tertiary` | `#ffffff` | `#00344a` |
| `--md-sys-color-tertiary-container` | `#3fc3ff` | `#3fc3ff` |
| `--md-sys-color-on-tertiary-container` | `#004e6b` | `#004e6b` |
| `--md-sys-color-background` | `#fbfbfd` | `#121316` |
| `--md-sys-color-on-background` | `#1a1c1e` | `#e3e2e6` |
| `--md-sys-color-surface` | `#fbfbfd` | `#121316` |
| `--md-sys-color-on-surface` | `#1a1c1e` | `#e3e2e6` |
| `--md-sys-color-surface-variant` | `#dfe2eb` | `#43474e` |
| `--md-sys-color-on-surface-variant` | `#43474e` | `#c3c7cf` |
| `--md-sys-color-surface-dim` | `#dadce0` | `#121316` |
| `--md-sys-color-surface-bright` | `#fbfbfd` | `#38393c` |
| `--md-sys-color-surface-container-lowest` | `#ffffff` | `#0d0e11` |
| `--md-sys-color-surface-container-low` | `#f5f5f8` | `#1a1c1e` |
| `--md-sys-color-surface-container` | `#efeff2` | `#1e2022` |
| `--md-sys-color-surface-container-high` | `#e9e9ed` | `#282a2d` |
| `--md-sys-color-surface-container-highest` | `#e3e3e7` | `#333538` |
| `--md-sys-color-outline` | `#73777f` | `#8d9199` |
| `--md-sys-color-outline-variant` | `#c3c7cf` | `#43474e` |
| `--md-sys-color-inverse-surface` | `#2f3033` | `#e3e2e6` |
| `--md-sys-color-inverse-on-surface` | `#f1f0f4` | `#2f3033` |
| `--md-sys-color-primary-fixed-dim` | `#ffba3b` | `#ffba3b` |
| `--md-sys-color-on-primary-fixed` | `#281900` | `#281900` |

`--md-shadow-rgb` is `0 0 0` in both themes.

### Chart Tokens

| Token | Light | Dark |
|---|---:|---:|
| `--chart-cat-1` | `#b8860b` | `#ffca74` |
| `--chart-cat-2` | `#00668a` | `#9edaff` |
| `--chart-cat-3` | `#7c3aed` | `#a78bfa` |
| `--chart-cat-4` | `#15803d` | `#4ade80` |
| `--chart-cat-5` | `#be123c` | `#fb7185` |

### Tailwind Theme Color Mappings

The baseline uses `@theme inline`, so Tailwind utilities resolve through live
CSS variables instead of fixed hex values.

| Tailwind token | Source token |
|---|---|
| `--color-primary` | `var(--md-sys-color-primary)` |
| `--color-on-primary` | `var(--md-sys-color-on-primary)` |
| `--color-primary-container` | `var(--md-sys-color-primary-container)` |
| `--color-on-primary-container` | `var(--md-sys-color-on-primary-container)` |
| `--color-primary-fixed-dim` | `var(--md-sys-color-primary-fixed-dim)` |
| `--color-secondary-container` | `var(--md-sys-color-secondary-container)` |
| `--color-on-secondary-container` | `var(--md-sys-color-on-secondary-container)` |
| `--color-tertiary` | `var(--md-sys-color-tertiary)` |
| `--color-tertiary-container` | `var(--md-sys-color-tertiary-container)` |
| `--color-on-tertiary-container` | `var(--md-sys-color-on-tertiary-container)` |
| `--color-background` | `var(--md-sys-color-background)` |
| `--color-on-background` | `var(--md-sys-color-on-background)` |
| `--color-surface` | `var(--md-sys-color-surface)` |
| `--color-on-surface` | `var(--md-sys-color-on-surface)` |
| `--color-surface-variant` | `var(--md-sys-color-surface-variant)` |
| `--color-on-surface-variant` | `var(--md-sys-color-on-surface-variant)` |
| `--color-surface-container` | `var(--md-sys-color-surface-container)` |
| `--color-surface-container-high` | `var(--md-sys-color-surface-container-high)` |
| `--color-surface-container-highest` | `var(--md-sys-color-surface-container-highest)` |
| `--color-outline` | `var(--md-sys-color-outline)` |
| `--color-outline-variant` | `var(--md-sys-color-outline-variant)` |

The baseline does not define Tailwind mappings for `surface-bright`,
`surface-container-lowest`, or `surface-container-low`. Adding those mappings is
a visual token change and must follow [WORKFLOW.md](./WORKFLOW.md).

### Readable Gold Text

`--md-sys-color-primary-fixed-dim` remains locked as the brand gold for dark
mode, decorative star marks, chart accents, and heatmap fills. It is not a
readable light-mode text color on `--md-sys-color-surface`.

Gold-accent text uses the semantic `.text-readable-gold` class instead of
`text-primary-fixed-dim`. The class resolves only through existing locked
tokens:

| Theme | Source token |
|---|---|
| Light | `var(--md-sys-color-on-primary-container)` |
| Dark | `var(--md-sys-color-primary-fixed-dim)` |

This preserves the visual baseline tokens while keeping light-mode gold text at
WCAG AA contrast.

Small text on `--md-sys-color-primary-container` must not lower
`--md-sys-color-on-primary-container` with opacity, because the full token pair
is only just above the WCAG AA threshold for normal text.

## Typography

The baseline font families are loaded in `web/app/layout.tsx` at commit
`689605c` and mapped in `globals.css`.

| Role | Baseline |
|---|---|
| Sans font | `var(--font-plus-jakarta), system-ui, sans-serif` |
| Mono font | `var(--font-geist-mono), ui-monospace, monospace` |
| Body font family | `var(--font-plus-jakarta), system-ui, sans-serif` |
| Body line height | `1.55` |
| Font smoothing | `-webkit-font-smoothing: antialiased` |
| Text rendering | `text-rendering: optimizeLegibility` |
| Mobile text adjustment | `-webkit-text-size-adjust: 100%` |

The locked global CSS does not define `--type-*` font-size tokens or a global
font-size scale. Component font sizes are Tailwind utilities. For the top
Chrome baseline, the wordmark is `text-[1.15rem]`, the star mark is
`text-[1.05em]`, nav links are `text-[0.8rem]`, and the optional tag is
`text-[0.7rem]`.

Adding global type-size tokens or changing these Chrome sizes is a visual
change.

## Spacing

The locked global CSS defines only a small set of spacing behavior:

| Surface | Baseline |
|---|---|
| Body bottom inset | `padding-bottom: env(safe-area-inset-bottom)` |
| App bar top inset | `padding-top: max(0.85rem, env(safe-area-inset-top))` |
| Highlight primitive `.hl` | `padding: 0.02em 0.22em` |
| Chrome horizontal gutter | `px-[clamp(1.25rem,5vw,2.5rem)]` in `Chrome.tsx` |
| Chrome bottom padding | `pb-[0.85rem]` in `Chrome.tsx` |
| Chrome main gap | `gap-4` in `Chrome.tsx` |
| Chrome nav gaps | `gap-x-3 gap-y-2`, `sm:gap-x-4` in `Chrome.tsx` |
| Chrome logo gap | `gap-2` in `Chrome.tsx` |
| Chrome tag padding | `px-2 py-0.5` in `Chrome.tsx` |

The baseline does not define global `--space-*` tokens. Adding them or changing
page spacing changes the visual baseline.

## Radius

The locked global CSS does not define global `--radius-*` or `--shape-*`
tokens.

| Surface | Baseline |
|---|---|
| Highlight primitive `.hl` | `border-radius: 12px` |
| Chrome tag | `rounded-full` |
| Theme toggle icon swap | no radius defined in `globals.css`; component utility classes own it |

Adding radius tokens or changing component radii is a visual change.

## Motion And Elevation

The non-color tokens from `globals.css` are part of the locked baseline.

| Token | Baseline |
|---|---|
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-spring` | CSS `linear(...)` spring curve from `globals.css` |
| `--elev-1` | `0 1px 2px rgb(var(--md-shadow-rgb) / 0.3), 0 1px 3px 1px rgb(var(--md-shadow-rgb) / 0.12)` |
| `--elev-2` | `0 1px 2px rgb(var(--md-shadow-rgb) / 0.3), 0 2px 6px 2px rgb(var(--md-shadow-rgb) / 0.14)` |

The baseline animation mappings are:

| Tailwind token | Source |
|---|---|
| `--animate-rise` | `rise 0.62s var(--ease-spring) backwards` |
| `--animate-pop` | `pop 0.9s var(--ease-spring) backwards` |
| `--animate-status` | `status-pulse 2.4s var(--ease-emphasized) infinite` |
| `--animate-page` | `page-enter 0.42s var(--ease-emphasized) backwards` |

The baseline includes reduced-motion handling: animations and transitions are
disabled under `prefers-reduced-motion: reduce`, and curve/bar end states remain
visible.

## Chrome Top Bar

The top bar baseline from commit `689605c` is:

| Aspect | Baseline |
|---|---|
| Component | `web/app/_explore/Chrome.tsx` |
| Client boundary | Server-rendered chrome shell; `SearchBox`, `LanguageSwitcher`, and `ThemeToggle` are client islands |
| Header position | `sticky top-0 z-20` |
| Layout | Mobile may wrap into two rows for touch targets; `sm+` keeps `flex items-center justify-between gap-4` |
| Border | `border-b border-outline-variant` |
| Background | `bg-surface/70` |
| Backdrop | `backdrop-blur-lg backdrop-saturate-150` |
| Safe area | `.app-bar` top padding from `globals.css` |
| Horizontal padding | `px-[clamp(1.25rem,5vw,2.5rem)]` |
| Bottom padding | `pb-[0.85rem]` |
| Logo | `inline-flex items-center gap-2 text-[1.15rem] font-extrabold text-on-surface` |
| Star mark | `star glyph`, `text-[1.05em] text-primary-fixed-dim`, `aria-hidden="true"` |
| Tag | `rounded-full bg-primary-container px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-on-primary-container` |
| Nav layout | Mobile uses a four-column grid for SearchBox / language / theme / menu; `sm+` returns to `w-auto gap-x-4 gap-y-2` |
| Nav label | `aria-label="Primary"` |
| Nav links | `font-mono text-[0.8rem] text-on-surface-variant transition-colors hover:text-on-surface` |
| Mobile disclosure | `<details>/<summary>` only below `sm`, pure HTML/CSS, `size-11` trigger, contains Pulse / Rankings / Categories / Compare / About |
| Responsive hiding | Inline links keep the baseline breakpoints: `pulse` and `rankings` shown from `sm`; `categories` from `md`; `compare` and `about` from `sm` |
| Controls | `SearchBox`, `LanguageSwitcher`, and `ThemeToggle` remain in the chrome |
| Mobile controls | `SearchBox` narrows below `sm`; `LanguageSwitcher` uses a 44px locale-code trigger below `sm` and full language label from `sm` |

Changing the top bar background, blur, border, spacing, text sizes, responsive
visibility, controls, or logo treatment is a visual change.

## Base CSS Behavior

The baseline includes these global behaviors:

- `html` uses `color-scheme: light dark`.
- Tap highlight is disabled with `-webkit-tap-highlight-color: transparent`.
- Body transitions background and text color over `300ms` using
  `--ease-emphasized`.
- Body uses `overscroll-behavior-y: none`.
- `.page-enter`, `.status-dot`, `.spine-bar`, `.spine-bar-y`, `.curve-line`,
  and `.curve-area` are CSS-only animation primitives.
- `@view-transition { navigation: auto; }` is enabled for cross-document page
  transitions when the browser supports it.
- Theme toggle sun/moon visibility is CSS-driven through `[data-theme]` and
  `prefers-color-scheme`.

These are visual or interaction baselines unless a change is strictly
non-visual accessibility work.
