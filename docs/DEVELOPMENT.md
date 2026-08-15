---
owner: development process
status: active
last_reviewed: 2026-08-16
source_of_truth_for:
  - developer workflow
  - documentation ownership practice
  - change playbooks
  - drift handling
---

# Development Guide

## Scope

This guide turns the codebase map into a repeatable development workflow. Use it
before making code changes so future work is supported by docs instead of
reverse-engineering decisions from code.

For the code map, see [CODEBASE.md](./CODEBASE.md). For project-wide ownership
rules, see [README.md](./README.md).

For issue shape, role boundaries, PR merge gates, and visual-change guardrails,
see [WORKFLOW.md](./WORKFLOW.md).

## Development Contract

Every non-trivial change should answer these questions before code is edited:

1. What user-visible behavior changes?
2. Which data contract or view path changes, if any?
3. Which route, component, or workflow owns the behavior?
4. Which doc is the source of truth and must be updated?
5. How will production on Vercel be verified?

The expected commit shape is:

```text
code change
tests or validation updates when applicable
owning docs update
```

Docs-only changes are allowed when the code already implements the behavior.

## Documentation Ownership

| Change type | Update this doc |
|---|---|
| Product scope, tracked-set assumptions | `REQUIREMENTS.md` |
| System architecture, hard constraints | `ARCHITECTURE.md` |
| Blob layout, workflow lifecycle, publish/rollback | `VERCEL-DATA-OPERATIONS.md`, `OPS.md` |
| JSON schema or persisted field | `DATA-CONTRACTS.md` |
| Bootstrap pipeline behavior | `PIPELINE.md` |
| Ranking algorithm or tie-breaking | `RANKING.md` |
| Route, page rendering, component/data-access pattern | `FRONTEND.md` |
| Visual language, tokens, component styling rules | `DESIGN-SYSTEM.md` |
| SEO templates, sitemap, robots, JSON-LD, OG images | `SEO.md` |
| Tests, validation gates, smoke coverage | `TESTING.md` |
| Category taxonomy or assignment behavior | `CATEGORIES.md` |
| Code structure or developer workflow | `CODEBASE.md`, `DEVELOPMENT.md` |
| Shipped user-visible feature | `CHANGELOG.md` |
| Open work or deferred decision | `ROADMAP.md` |

## Change Playbooks

### Add Or Change A Page

1. Find the route in `web/app/`.
2. Read existing data through `web/lib/data/*`; avoid direct Blob fetches in
   page code.
3. Keep the main page server-rendered unless interactivity requires a client
   component.
4. Add metadata/JSON-LD when the page is indexable.
5. Update `FRONTEND.md`; update `SEO.md` when URL, title, canonical, sitemap, or
   indexability changes.

### Add Or Change A View Field

1. Update the Zod contract in `web/lib/contracts/*`.
2. Update producers in `web/lib/workflows/recompute/*` or cron/workflow steps.
3. Update read helpers in `web/lib/data/*`.
4. Update pages/components that consume the field.
5. Add contract/recompute tests when the field affects behavior.
6. Update `DATA-CONTRACTS.md` and any owning feature doc.

### Change A Workflow Step

1. Read `web/lib/workflows/refresh.ts` to confirm step order.
2. Keep steps idempotent and retry-safe.
3. Write new artifacts under `views/<run_id>/` until validation passes.
4. Update `web/lib/workflows/steps/validate.ts` when a new published invariant
   should block bad data.
5. Update `VERCEL-DATA-OPERATIONS.md`, `OPS.md`, and `TESTING.md` as needed.

### Change Category Behavior

1. Update `web/lib/categories/rules.ts`.
2. Update `web/lib/categories/rules.test.ts`.
3. If published artifacts change shape, update `web/lib/contracts/categories.ts`.
4. If only assignment behavior changes, trigger a production refresh after
   deployment so `categories/assignments.json`, registry counts, and category
   ranks are regenerated.
5. Update `CATEGORIES.md`.

### Change Ranking Behavior

1. Update pure ranking logic in `web/lib/workflows/recompute/ranks.ts` or
   `windows.ts`.
2. Add focused tests under `web/lib/workflows/recompute/`.
3. Check integration expectations under `web/lib/integration/` when rank files
   or windows change.
4. Update `RANKING.md`, `DATA-CONTRACTS.md` if output shape changes, and
   `TESTING.md` for validation changes.

### Change Repo Or Org Detail Pages

1. Start from the shared views `web/app/_localized/repo.tsx` or
   `web/app/_localized/org.tsx`; route adapters are listed in
   [UIUX-ROUTE-INVENTORY.md](./UIUX-ROUTE-INVENTORY.md).
2. Confirm the needed fields exist in `RepoEntity` or `OrgEntity`.
3. Derive UI-only projections in the page when they can be computed from
   existing entity data.
4. Use shared components from `web/app/_explore/` when possible.
5. Update `FRONTEND.md` and `SEO.md` if content, metadata, or internal links
   change.

## Vercel-First Verification

The project is operated Vercel-first. Do not rely on a local dev server as the
final verification path.

Branch topology and promotion are owned by [OPS.md](./OPS.md) §Branch topology /
staging. Feature work merges into `pre`, staging verification uses
`https://pre.gitstarclub.com`, and production promotion is a merge from `pre` to
`main`.

Preferred production verification sequence:

1. Merge the feature PR into `pre`.
2. Wait for the fixed staging domain, `https://pre.gitstarclub.com`, to serve the
   Preview deployment.
3. Verify the affected staging URL or behavior on `pre`.
4. Promote by merging `pre` into `main`.
5. Wait for the Vercel production deployment to serve the new HTML or behavior.
6. For code-only read-side changes, verify the affected production URL directly.
7. For recompute/category/data changes, trigger the production refresh workflow
   after deployment and wait for `views/latest.json` to point at the new run.
8. Verify the exact production page or Blob view that proves the change.

Useful production signals:

- `views/latest.json.version` equals the expected refresh run id.
- `ops/workflows/<run_id>/manifest.json.status` is `published`.
- `ops/workflows/<run_id>/validation.json.ok` is `true`.
- A representative production URL returns the expected HTML.

## Local Commands

These commands exist for code-level validation, CI, or local investigation. Use
them when appropriate, but do not treat them as the final deployment check.

```text
cd web
bun run lint
bun run typecheck
bun run typecheck:tests
bun run typecheck:scripts
bun test lib/
bun run build
```

Targeted examples:

```text
bun test lib/categories/rules.test.ts
bun test lib/contracts/contracts.test.ts
bun test lib/workflows/recompute/entities.test.ts
```

Install and CI use Bun with frozen lockfiles (`bun install --frozen-lockfile`
in `web/` and `pipeline/`). Do not switch the site off Bun.

## Dependabot And Lockfiles

Dependabot is configured in `.github/dependabot.yml` for `web/`, `pipeline/`
(npm ecosystem, Bun lockfiles), and GitHub Actions. All three target branch
`pre` so dependency PRs follow the same staging path as feature work.

If a Dependabot PR updates `package.json` but omits the matching `bun.lock`,
**do not merge it**. Close the PR and open a replacement that includes the
lockfile (same pattern as the #351 replacement for #342–#344). CI will fail
`bun install --frozen-lockfile` on package.json-only bumps.

When reviewing or authoring a lockfile replacement:

1. Branch from `pre`.
2. Apply the intended version bumps, then run `bun install` in the affected
   package directory so `bun.lock` updates.
3. Confirm `bun install --frozen-lockfile` and the usual lint/typecheck/tests
   pass before merge into `pre`.

## Pull Request Or Commit Checklist

Before finishing:

- Code uses existing layers instead of bypassing them.
- Persisted data shape changes have Zod contract updates.
- Published data changes have validation or tests when risk warrants it.
- User-visible route/content changes update `FRONTEND.md` or `SEO.md`.
- Category/ranking/data behavior changes update the owning doc.
- Production verification plan is clear.
- No secrets are printed or committed.

## Drift Handling

When code and docs disagree:

1. Inspect the current code and production behavior.
2. Identify the owning doc from the table above.
3. Update the doc to match the intended behavior, or update code to match the
   documented contract.
4. Keep the code and doc fix in the same commit when possible.
