# Issue 819: mobile header search width

## Goal and scope

Let the shared header search input fill the available mobile row so placeholders
are only shortened when their text actually exceeds the input. Preserve the
existing ellipsis fallback and widths at the small and large desktop breakpoints.
Update the existing regression test and document the visual behavior.

Out of scope: translated copy, desktop layout, new pages, deployment and secrets.
Stay on the current branch and deliver one small commit.

## Acceptance and verification

- The input flexes below the small breakpoint, with no fixed mobile width.
- The existing test rejects the previous narrow mobile width.
- Check all seven locales at 390 px in the built preview using bundled Chromium
  with a fresh profile, including actual text widths and overflow behavior.
- Run the owner's full web coverage, preview build, Worker tests and Astro tests.
- Save final light-mode Japanese and English header screenshots outside Git.

## Results

- The updated regression test failed against the old input classes before the fix.
- Baseline built preview: input width 96 px at 390 px, despite a 350 px field.
  At viewport widths 320, 640 and 1280 px the baseline input widths were 80,
  176 and 224 px respectively.
- Additional `bun run lint:docs` check is blocked by existing unresolved paths
  in plans 760, 779, 781 and astro-accept-1-baseline. Its markdown test reports
  references to scripts/perf-local.ts and scripts/perf-metrics.ts; these files
  and references are outside this issue's scope.
- Updated the shared page HTML fingerprints for the intended search class change.
  Before updating them, normalizing only the new search classes back to the old
  classes made every original assertion in that test file pass.
- Web lint and all three typechecks passed (lint has 14 existing warnings).
- Preview build passed; all 22 built Worker tests and all 422 Astro tests passed.
- Full web coverage passed: 2225 passed, 49 skipped, zero failures; line
  coverage 90.20%, function coverage 90.76%.

## Built preview at 390 px

Bundled Chromium, fresh temporary browser profile, light mode, rankings pages.
The input now measures 300 px inside the same 350 px search field.
Every locale shows its complete dictionary `search.placeholder` value, including
its original trailing ellipsis. None needs added truncation or shows a half glyph.
The exact copy remains in web/lib/i18n/dictionaries/ for the locale named below.

| Locale | Measured text width | Visible result |
| --- | --- | --- |
| en | 160 px | Full dictionary placeholder |
| ja | 112 px | Full dictionary placeholder, including the search verb |
| zh | 60 px | Full dictionary placeholder |
| zh-TW | 60 px | Full dictionary placeholder |
| ko | 81 px | Full dictionary placeholder |
| es | 160 px | Full dictionary placeholder |
| fr | 176 px | Full dictionary placeholder |

Screenshots were visually reviewed for all seven locales. Forcing the input
to 40 px in the browser also preserved whole glyphs plus an ellipsis in each
locale, confirming the overflow fallback. At 320 px the input
uses 230 px. At 640 and 1280 px it still uses 176 and 224 px, identical to the
baseline. Before and after images are uncommitted under `$HOME/ktmp/evidence-819`.
The final manager screenshots will be saved last to `$HOME/evidence-819b`.

## Commands

The owner's install/build/test sequence (with KANBAN_TMP and TMPDIR set to
`$HOME/ktmp`):

```bash
bun install --frozen-lockfile &&
(cd pipeline && bun install --frozen-lockfile) &&
(cd web && bun install --frozen-lockfile && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov) &&
(cd astro && bun install --frozen-lockfile && bun run build:pre && bun run test:worker -- --timeout 30000 && bun run test)
```

Verification uses the current checkout: the owner's workspace rule forbids
copying the repository and switching to another checkout. No owner environment
files, live smoke flags, deployment commands or credentials are used.
