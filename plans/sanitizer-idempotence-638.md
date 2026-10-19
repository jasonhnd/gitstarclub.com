# Sanitizer idempotence and bearer assignment (#638)

## Goal

Make `sanitizeErrorText` stable under repeated calls and stop `bearer = value`
from leaking through the bearer-header pattern.

## Scope

- `web/lib/observability/sanitize-error-text.ts`: an assignment value that is
  already a redaction marker is kept as is; the bearer-header pattern no longer
  matches when `=` or `:` follows the word, so the assignment pass handles it.
- Tests in `web/lib/observability/sanitize-error.test.ts`.

## Out of scope

Data coverage, other sanitizer patterns, alert or webhook wiring.

## Acceptance

`token=CANARYstart:CANARYtail!` stays `token=[redacted]` on repeated calls;
`bearer = !CANARYpunctuation42` is redacted; `Authorization: Bearer X` still is.
Full AGENTS.md gate passes.
