---
owner: architecture / operations
status: superseded
last_reviewed: 2026-10-22
source_of_truth_for:
  - retained vinext comparison host
---

# Retained vinext comparison host

[ASTRO-HOST.md](ASTRO-HOST.md) supersedes this document for the current integrated
site source. This source change does not claim a live deployment or cutover.
`web/` remains buildable as the parity baseline and supplies shared data,
operational and presentation modules until the migration's after-cutover move.

The retained host uses vinext 1.2.1, Vite 8.3.3 and the exact pins in
[web/package.json](../web/package.json). Its independent HTML/RSC core snapshots
and publication-fenced Cache API/KV adapter remain unchanged. Astro does not
serve its RSC payloads or private snapshot assets.

From `web/`, the existing `build:production`, `build:pre` and matching
`validate:host -- --mode ...` commands remain the offline AGENTS verification
and comparison gate. Use only the local read-only fixture and a fresh detached
checkout; do not copy owner environment files. Skip cf:dry-run and every legacy
platform command by owner order. Actions stays disabled.

The original [Worker shell](../workers/gitstarclub-web/src/shell.ts),
[queue/scheduled entry](../workers/gitstarclub-web/src/index.ts) and
[typed configuration](../web/cloudflare.config.ts) remain shared sources for
Astro integration. All resource names, secrets, schedules and production/preview
activation decisions remain unchanged. The old cockpit source stays here;
Astro returns 404 until its separately authorized migration.
