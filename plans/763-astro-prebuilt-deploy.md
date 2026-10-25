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
