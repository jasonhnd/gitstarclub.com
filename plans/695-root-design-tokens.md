# Root design token translation

## Goal

Deliver owner request SB-20261021-02 and issue #695: expose the locked design
baseline as the supplied Google-format `DESIGN.md` without changing its bytes.

## Scope

1. Install repository dependencies with the verified Node 24.20.0 and Bun 1.4.2
   toolchain, confirm the branch starts at `origin/pre`, and record this plan.
2. Verify the source SHA-256, copy it unchanged to root `DESIGN.md`, and add the
   precedence and synchronized-maintenance pointer to `docs/DESIGN-SYSTEM.md`
   in the same commit.
3. Pin `@google/design.md` exactly as a root development dependency and add a
   local-only `lint:design` script plus its documentation. Keep the root Bun
   lockfile. Skip this step if offline-safe execution or the high/critical audit
   gate cannot be satisfied, and record the reason.
4. Run the complete current AGENTS.md bootstrap and offline static/build block
   on the exact head in one fresh detached shared clone. Record the results,
   delete the temporary clone and outputs, and open one pull request into `pre`
   for independent review.

## Out of scope

Do not edit or reformat the supplied `DESIGN.md`. Do not change product pages,
CSS, components, visuals, data scope, CI workflows, `.delivery.yml`, AGENTS.md,
Worker configuration, or deployment scripts. Do not enable GitHub Actions, run
Wrangler or `cf:dry-run`, deploy, call live refresh endpoints, merge pull
requests, or push protected branches. Screenshots and unrelated notes are not
part of this task.

## Acceptance

- The source and root copy are each 8,466 bytes with SHA-256
  `7d8ca2d7e639397a01d5ca64c1aaabbc97d6629c0dfd934cbe1a81181f58d508`.
- The baseline pointer requires changes to both documents in the same commit;
  `docs/DESIGN-SYSTEM.md` and `web/app/globals.css` take precedence on conflicts.
- The optional pinned local linter exits nonzero only for errors and runs
  without network access after installation. Its audit has no high or critical
  findings. Record actual error and warning counts.
- All current AGENTS.md static checks, the full web coverage suite, both
  fixture-backed Vite builds, and matching host validations exit zero in the
  detached checkout. Use no owner environment files or live opt-ins.
- Use the owner-authorized shared toolchain cache and default shared Bun cache;
  keep the verification clone and outputs under this card's local directory.
- The pull request targets `pre`, contains `Closes #695`, both hashes, exact
  tested commit, all command results, and the owner-ordered `cf:dry-run` skip.
- Commit each completed step. Leave the worktree clean and report final card
  temporary-directory size in the handoff to the independent reviewer.
