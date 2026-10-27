# Issue 851: Pipeline dependency audit

Refs #851

## Goal

Remove the pipeline's two high dependency advisories using exact patched versions.

## Scope

- Update the existing Undici override from 6.28.1 to 6.29.1 and regenerate only affected lock entries. The parent, `@vercel/blob@2.6.1`, accepts `^6.23.0`.
- Add a Zod 4.6.6 override. The installed path is `@vercel/blob@2.6.1 > @vercel/oidc@3.8.0 > @vercel/cli-config@0.2.0 > zod@4.1.11`. The immediate parent pins vulnerable 4.1.11 exactly, so a lock-only update cannot repair it. Keep the parent versions and verify its schema API with the patched Zod 4 release.
- Preserve the audit command and high severity threshold.

## Advisory and package inspection

- [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c): high, affects Undici `>=6.23.0 <6.29.1` on version 6.
- [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685): moderate, affects Undici `>=6.5.0 <6.29.1` on version 6.
- [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): high, affects Zod `<4.6.6`.
- Official registry metadata and integrity-checked tarballs show MIT licenses, no executable entry points, and no binary payloads in either target. Neither has preinstall, install, or postinstall hooks. Undici does declare a development `prepare` script; this is recorded explicitly rather than claiming it has no lifecycle scripts. Zod has no prepare hook.

## Out of scope

Web, root and Astro dependencies; CI and deployment configuration; audit suppression; documentation repairs; external sites or data stores; publishing and merging. The ten reported existing documentation-reference failures are outside this card.

## Acceptance and verification

1. Record the exact base, frozen install, audit outputs and installed dependency paths before editing.
2. Use checksum-verified Node 24.20.0 and Bun 1.4.2; regenerate the pipeline lockfile with no unrelated package changes.
3. Remove the task-installed pipeline dependencies and prove a fresh frozen install, unchanged high-threshold audit, all pipeline tests, root runtime checks, and parent schema compatibility. Check every installed Undici and Zod copy.
4. Save command exits, machine-readable audits and graphs, package inspection, timing and diff evidence under `~/evidence/`.
5. Commit only this plan and the pipeline manifest/lockfile. Full web/static/type checks and local fixture builds remain for the separate independent verification card; pipeline checks do not establish full static success.

## Implementation result

The fresh frozen install and unchanged high-threshold audit exit 0; the machine-readable audit is empty. All 211 pipeline tests across 12 files pass, as do the root runtime assertion, four runtime contract tests, and pure parent schema/import compatibility checks. The installed graph has exactly one Undici 6.29.1 and one Zod 4.6.6 copy, with every other package version unchanged. Commands ran with a clean environment and task-local caches. Full static verification and fixture builds remain pending independent review. Evidence is in `~/evidence/REPORT.md` and companion files; no remote write or merge was performed.
