# #504 Fix .cursor/agents + AGENTS.md per review

- **task_id**: `gitstarclub-cursor-agents-fix-review-cca-001`
- **baseline**: `pre` (already includes #503)
- **goal**: Draft PR → `pre`; FINISHED is not a merge

## Scope

1. Change `description` in the 13 `.cursor/agents/*.md` files to "Use when you need to .... Do not use for ....", and separate vercel/cloudflare, researcher/pm, and code-reviewer/test-engineer.
2. Add `readonly: true` to `test-engineer`, `github-ops`, and `notion-ops`; keep it on `researcher` and `code-reviewer`; do not add it to the other writable roles.
3. Rewrite the root `AGENTS.md`: drop Grok-only entries; defer to `.grok/rules/pre-only.md` and `.delivery.yml`; keep only four executable rules; create this directory.

## Out of scope

- Do not touch `main`; do not merge this PR
- Do not change product code / Workers / cron
- Do not create a root `WORKFLOW.md` (the repository does not have that file today)
