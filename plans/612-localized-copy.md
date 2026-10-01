# Issue 612: Localized copy formatting

## Goal

Fix Korean category list conjunctions and consolidate the live localized copy
builders, preserving the outputs of the other six locales and shared date APIs.

## Scope

- `web/app/_localized/detail-copy.ts` and `seo-copy.ts`.
- New modules under `web/app/_localized/detail-copy/` for locale tables and
  shared formatting.
- `web/lib/geo-capsules.ts`, `geo-faq.ts`, their existing tests, and the new
  `web/lib/localized-copy-format.test.ts`.
- This required plan and desktop/mobile screenshot evidence under `plans/`.

## Out of scope

Other pages, repository/organization snippets from issue 610, dictionaries,
ranking period semantics, caller-facing label signatures, CSP, language links,
the Star component, CI/deployment configuration, and live data/platform calls.
No merge, force push, or push to protected branches.

## Steps

1. Install pinned dependencies, inventory live callers, and capture baseline
   builder outputs and Korean populated/empty pages using local fixtures.
2. Extract typed locale tables and shared formatting; fix Korean conjunctions
   while keeping equivalent output in the other locales.
3. Move capsule/FAQ assertions to live builders, retire unused English copy
   implementations, and preserve shared capsule types and date resolvers.
4. Verify full static checks and fixture builds in a fresh detached worktree;
   prove Korean regression tests fail with the original formatter restored.
5. Capture after screenshots, commit evidence, push only the feature branch,
   and open one PR against `pre` for Claude-family review and owner visual
   sign-off.

Commit each completed step. Keep transient fixtures, logs, backups, and
verification trees in `/tmp/GSC_0056/`, and leave the task checkout clean.

## Acceptance

- All seven locale tables have identical keys; builders resolve their placeholders.
- Korean category capsule/FAQ lists use Korean conjunctions; the other six
  locales retain their baseline output.
- Tests exercise the production localized builders, including empty and
  missing-date paths, visible HTML, and FAQ structured data.
- Shared capsule/date types and functions and label helper signatures remain.
- Full `static` job, fixture production build, and pre-only Cloudflare dry run
  pass with checksum-verified Node 24.20.0 and Bun 1.3.14 in a clean environment.
- No lockfile changes or edits outside the issue scope and required evidence.
- PR includes `Closes #612`, verification, limitations, and Korean desktop and
  mobile before/after screenshots, including empty states.
