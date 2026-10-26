# Issue 824-A round 1: publisher core review fixes

## Goal

Match the pinned cf listing protocol and refuse any ambiguous existence result
before upload.

## Scope

- Parse the actual JSON array, validate all keys against the full requested key
  prefix, and require a short page before declaring an exact key absent.
- Disable cf delegation in the child environment while retaining argv arguments.
- Refuse objects above the documented 300 MB body cap before reading or uploading;
  open local inputs with O_NOFOLLOW and verify the opened file.
- Update fake-runner regression tests and publisher documentation.

## Out of scope

Bucket access, credentials, deployment, Wrangler, writer leases, target guards,
pointers, branch changes, repository copies, and publishing remote changes.

## Acceptance

Short-page absence uploads; exact presence compares bytes; prefix children do not
count as presence. Full-page absence and malformed listings refuse without puts.
Tests prove delegation is disabled and oversized objects refuse before cf calls.
Run the requested pipeline and full web coverage suites, plus the available static
checks and local builds, in this checkout with a clean environment and all caches,
logs, and temporary files under `.kanban-work/824a-r1`. The owner prohibits another
checkout and requires the current branch, overriding the generic clone workflow.

## Results

Implementation commit: `8eaf5cd` (`fix: match pinned cf repair publisher protocol`).
The delivery documentation also inventories the child-only `CF_DELEGATION` setting
in `docs/OPS.md`, as required by the documentation contract check.

Verification stayed in this checkout and on the original branch. All commands
used clean environments and card-local caches, logs, and temporary files under
`.kanban-work/824a-r1`. The requested suite and initial lint/typechecks used the
installed Node v24.21.0 and Bun 1.4.2. The official archive bootstrap verified
SHA-256 checksums and installed Node v24.20.0 and Bun 1.4.2 under the card directory;
the static block, builds, and final documentation checks used that toolchain.

- Requested frozen-lockfile installs and test sequence: passed, with no lock changes.
- `cd pipeline && bun test --timeout 30000`: 206 passed, zero failed.
- `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`:
  2,227 passed, 49 skipped, zero failed across 215 files. Coverage gate passed:
  90.18% lines and 90.77% functions.
- Publisher regression suite: 33 passed. Covers empty/short arrays, exact matches,
  prefix-only children, full-page ambiguity, full-page exact presence, malformed
  records, child environment/argv, and oversized objects/manifests.
- Web lint passed with 14 existing warnings; all three typechecks passed.
- View fixture validation and host dependency graph validation passed.
- Local `build:production` (via `build`) and `build:pre`, with matching
  `validate:host`, passed: 234 routes and 467 artifacts in each mode. Both used
  only the loopback GET/HEAD fixture and packaged fonts.
- Documentation unit tests: 44 passed. Documentation references, environment
  inventory, maintained facts, and CI deployment gate assertions passed.
- `lint:docs` remains blocked by the existing missing metadata frontmatter in
  `docs/analysis/743-preview-empty-monthly.md`; that file was not changed.
- The prescribed static block stops at the existing pipeline dependency audit:
  high-severity advisories for `undici@6.28.1` (GHSA-xjj6-f33q-929c) and
  `zod@4.1.11` (GHSA-mrhx-c7xc-m3w5). Web audit passed. Dependencies were not changed;
  checks after this blocked step were run separately as recorded above.

No bucket access, credentials, deployment, Wrangler, branch changes, repository
copies, or remote writes were used. Writer exclusion and target guards remain
reserved for the later issue 824 cards before any real bucket use.
