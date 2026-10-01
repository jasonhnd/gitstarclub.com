# 574 R2 runbook rollback, acceptance, and stage 4 checklist

## Goal

Correct the R2 cutover runbook for review findings F3 through F6 on issue #574. Docs only.

## Scope

- `docs/R2-CUTOVER.md`
- `docs/OPS.md`, where it states the same stage 2, stage 3, or stage 4 step
- This plan

## Out of scope

- `scripts/cf-ci-gates.mjs`, `scripts/cf-ci-gates.test.mjs`, and `web/scripts/cf-opennext-build.ts` (the stage 4 pull request changes those; this issue only lists them)
- Worker wrangler config, CI workflows, `.delivery.yml`
- Bucket writes, deploys, `wrangler rollback`, and Cloudflare or Vercel API calls
- README and `AGENTS.md`, unless a sentence there states a step this issue changes

## Acceptance

- A first R2 publish is documented as having no prior generation. `--rollback` of that same generation is `already-rolled-back`, not an undo. A guarded, owner-authorized quarantine is written. Later publishes roll back to `previous_generation`.
- Stage 4 rollback restores `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z` and records `wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web` (read-only check on 2026-10-01: that version was 100% of Worker `gitstarclub-web`). Smoke checks that rankings show real rows.
- Stages 2 and 3 accept the bootstrap pointer, phase manifests, and real page or object data. They do not require `views/latest.json`. A managed views pointer, when needed, comes from an authorized refresh publish. It is never hand-written.
- The stage 4 pull request checklist names the gate contract, its tests, `STORAGE_READ_DRIVER=r2`, the production R2 base, and clearing the blob build variables.
- `bun run lint:docs` passes. Every runbook command in the edited steps names the Worker, the wrangler env, and the bucket. `docs/R2-CUTOVER.md` and `docs/OPS.md` agree on those steps.
