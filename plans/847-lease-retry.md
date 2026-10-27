# Issue 847: controlled lease replacement retry

## Goal

Allow a repair publisher that still owns an unexpired workflow lease to retry a lease renewal or release after an ambiguous cf put response.

## Scope

- Add an explicit expected-prior-state check to the shared cf retry boundary for lease control writes only.
- Keep exact-key rereads, local byte snapshots, and SHA-256 readback.
- Cover authentication, transient responses, ownership and expiry changes, read failures, and same-process renewal/release ordering with fake runners.
- Document the remaining interprocess read/check/write race in `docs/OPS.md`.

## Out of scope

- Changing acquisition, immutable generation objects, the bootstrap pointer, runtime leases, Cloudflare resources, or deployment.

## Acceptance

- Renewal and release resend only when the exact prior bytes still represent this unexpired running owner and fencing token.
- An exact intended lease can count as applied only when the prior active lease remains valid; all other remote states fail closed.
- Generic puts stay immutable, and focused plus full pipeline and web suites pass without real bucket access.
