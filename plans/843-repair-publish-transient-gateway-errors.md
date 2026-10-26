# Issue #843: retry transient repair publisher gateway errors

## Goal

Let the guarded repair publisher finish when the pinned `cf` CLI returns a
transient HTTP 502, 503, or 504 during a long publication.

## Scope

- Match only the final HTTP status line in the CLI's ANSI-stripped `APIError`
  box. Retry 502, 503, and 504 with a 30-second wait plus jitter, sharing the
  six-retry budget already used by 429.
- Preserve the exact-key recheck before resending a put.
- Cover boxed JSON and HTML failures, non-transient failures, retry exhaustion,
  and a mixed 429/gateway sequence with fake runners.
- Update the operations troubleshooting and timing guidance.

## Pinned CLI investigation

`web/node_modules/cf/dist/src-BUH-P_zd.mjs` (`Gr`) renders a failed API call
with `blocks-Bat9A8V_.mjs` (`l`). The box has `┌ APIError`, body/error lines
prefixed by `│`, and `└`; `Gr` appends a final status line such as
`504 Gateway Timeout · HTTP /accounts/.../objects/<key>`. The raw HTML body can
appear earlier in the same box. Response headers are not included in this
rendered error. The API client in `api-eMuS5GI1.mjs` can retry 502/503/504
internally before the CLI returns a final error; the publisher sees only that
final error.

There is **no server-side object copy command** in this pinned CLI. The R2
object command registration in `web/node_modules/cf/dist/r2-2QpT_Gso.mjs`
contains `list`, `delete`, `get`, `patch`, and `put`, with no
`cf r2 objects copy` (and therefore no copy flags). The available transfer
commands are `cf r2 objects get <object-key> --bucket-name <bucket>` and
`cf r2 objects put <object-key> --bucket-name <bucket> --file <path>`;
the publisher uses those flags. A copy path is outside this card.

## Out of scope

Bucket access, credentials, deployment, copy implementation, and changes to
guards, operation order, enumeration, or verification.

## Acceptance

- Only authoritative boxed 429/502/503/504 statuses retry, with at most six
  total transient retries per call; 500, 400, 403, and HTML body mentions fail
  immediately.
- Each gateway retry waits 30 seconds plus less than one second of jitter.
- Put retry outcomes remain identical/skipped, different/refused, or
  absent/resent after the exact-key recheck.
- The requested pipeline suite and complete web coverage suite pass on the
  current branch without bucket access.

## Verification

- On the current branch, the requested frozen installs and suites passed:
  pipeline 211 passed, zero failed; web 2,620 passed, 49 skipped, zero failed.
  The web coverage gate passed at 90.51% lines and 91.11% functions.
- Node v24.21.0 and Bun 1.4.2 satisfied the runtime assertion. The host graph,
  CI configuration assertion, web lint (14 warnings, zero errors), all three
  typechecks, and view fixture validation passed.
- Local production and pre builds and matching host validations passed with a
  read-only fixture. Each mode produced 234 routes and 467 artifacts.
- The full static job cannot pass as checked: documentation lint reports ten
  unresolved links to removed performance scripts in older plans, and the
  pipeline dependency audit reports two high transitive advisories (`undici`
  and `zod`). The web dependency audit passed. These findings are unrelated to
  this card's files.
- The owner's workspace instruction kept verification on the current branch
  instead of the repository's detached-clone workflow. No bucket, credentials,
  deploy, browser, branch switch, or repository copy was used.
