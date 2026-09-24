# AGENTS

Cursor subagent definitions for this repository live in `.cursor/agents/`.

Branch and merge policy is owned by `.grok/rules/pre-only.md`. Required CI checks and the delivery pipeline are owned by `.delivery.yml`. This file does not repeat or override them.

This repository currently has no root `WORKFLOW.md`. Follow pre-only plus `.delivery.yml`.

## Executable rules

1. Name each spawned agent `[role][project] task`.
2. In output for Jason, the first time a term appears, explain it in plain language.
3. Do not merge to `main` automatically. Merging to `pre` is allowed.
4. Write each task plan as markdown under `plans/`.
5. All repository text, commit messages, issues, and pull requests are English. The only exception is product locale copy for readers of the zh / zh-TW / ja site (dictionaries, localized pages, and tests that assert that copy).
