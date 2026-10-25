# Astro preview artifact deployment (#763)

## Goal

Make the authorized preview deployment consume the reviewed, self-contained Astro artifact and reuse the existing preview page-cache namespace.

## Scope

- Preserve all preview deployment guards and the pinned cf version.
- Pass a real output directory to cf without committing generated output.
- Share the preview KV binding configuration between web and Astro, preserving production configuration and disabling provisioning.
- Add regression coverage and update the deployment documentation.

## Out of scope

Deployments, Cloudflare write calls, namespace creation, production configuration changes, CI changes, branch changes, and repository copies.

## Acceptance

- Tests verify the preview KV namespace id, unchanged production binding, and a non-symlink output path passed to cf.
- The complete Astro test suite passes after implementation; remove any generated real `astro/.astro` directory before the final pre build.
- Run the web static checks and local builds without live-service test opt-ins; report any existing failures.
- No deployment or remote mutation runs.

## Verification approach

The owner's current-card instructions require work only in `~/w` on the current branch and forbid repository copies. Run verification in this checkout, using a clean environment, checksum-verified Node v24.20.0 and Bun 1.4.2, with scratch files, logs, and caches under `.kanban-work/763/`. Do not copy environment files or enable GitHub Actions.

## Results

Implementation tested at `8586c13`; the final documentation commit only records these results.

- `cd astro && bun run test`: 182 passed, zero failed, including preview KV identity, unchanged production KV configuration, and a self-contained deployment working directory without symlinks.
- `cd astro && bun run typecheck` and `bun run validate:graph`: passed.
- Web lint, all three typechecks, graph validation, and fixture view validation: passed.
- `cd pipeline && bun run test`: 205 passed, zero failed.
- `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`: 2,172 passed, 49 skipped, zero failed; line coverage 90.05%, function coverage 90.70%.
- `node scripts/assert-cf-ci-gates.mjs`: passed, including unchanged production configuration and preview trigger policy.
- Web and Astro `build:production`, `build:pre`, and the matching `validate:host` commands: passed with local read-only fixtures. Each web mode validated 234 routes and 467 artifacts.
- The pinned cf package's build-output reader accepted a real copied Astro pre artifact, including its manifest, assets, and existing preview KV namespace id. No deployment command was invoked.
- The full static job remains blocked by existing high-severity dependency advisories for undici and zod. Both dependency audits fail. Documentation lint also fails on existing unresolved performance-script references in earlier plans. Dependency pins and those plans are outside this card's scope.
- No deployment, Cloudflare write call, namespace creation, production endpoint call, or branch change occurred. Generated Astro types use the card-local symlink, so no real test-generated `astro/.astro` directory remains.
- Git push authentication is unavailable in the sandbox. Changes remain committed on `ib/gsc-763`; the pull request against `pre` has not been opened.

Logs, verification scripts, caches, and build output remain under `.kanban-work/763/` and are locally ignored.
