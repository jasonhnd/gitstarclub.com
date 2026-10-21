---
owner: architecture / operations
status: active
last_reviewed: 2026-10-19
source_of_truth_for:
  - vinext Worker configuration and delivery
  - hybrid page cache implementation
  - local host verification
---

# vinext Worker host

The checked-in host uses vinext 1.2.1, Vite 8.3.3, Cloudflare Vite plugin
2.0.0-beta.v.2 and cf 1.0.0-beta.18. Next 16.4.2 remains a types/lint
compatibility dependency; Vite compiles and serves the application. React,
React DOM and the server component transport are all 19.3.1. The pinned
[compatibility patch](../web/patches/vinext@1.2.1.patch) normalizes unsupported
native fetch cache options after the framework has implemented their cache
semantics. Frozen installs apply it; builds never modify downloaded packages.
The new font-parser dependency's fflate 0.7 branch is pinned to patched 0.7.5
for [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98);
the existing 0.8.3 branch remains unchanged.

This PR changes source and local evidence only. It does not claim a live
cutover. [R2-CUTOVER.md](R2-CUTOVER.md) remains the storage acceptance record;
its older host commands are historical. GitHub Actions remains disabled by
owner decision. Required job names remain `static` and `production-build`.

## Configuration and commands

[Typed configuration](../web/cloudflare.config.ts) uses
[the public contract](../web/host-contract.mjs) and rejects implicit modes.
The account is configured at the top level. Both modes retain `nodejs_compat`,
strict public fetch compatibility and observability.

| Contract | production | pre |
| --- | --- | --- |
| Worker and self-reference | gitstarclub-web | gitstarclub-web-pre |
| DATA bucket | gitstarclub-data-prod | gitstarclub-data-pre |
| MEDIA bucket | gitstarclub-assets | gitstarclub-assets |
| Queue producer and consumer | gitstarclub-jobs | gitstarclub-jobs-pre |
| Queue maximum batch / retries | 1 / 2 | 1 / 2 |
| Public data origin | data.gitstarclub.com | data-pre.gitstarclub.com |
| Public Worker / version URLs | disabled / disabled | enabled / enabled |
| Indexing | indexable | noindex, nofollow |
| Scheduled triggers | absent | absent |

KV means Cloudflare's persistent key/value cache. The `GSC_CACHE` namespace is
provisioned by cf per Worker/binding, with no shared namespace ID in source.
Local builds simulate all resources; no remote binding is selected. No cache
bucket, runtime database, Durable Object, routes, DNS or schedules are added.
Secrets remain platform-managed and are never copied into the public contract.

From `web/`, after the checksum-verified AGENTS bootstrap:

```bash
bun install --frozen-lockfile
bun run validate:graph
bun run build:production
bun run validate:host -- --mode production
bun run build:pre
bun run validate:host -- --mode pre
bun run start -- --host 127.0.0.1 --port 4176
```

Use the read-only fixture and clean environment from [AGENTS.md](../AGENTS.md)
for offline builds. The selected mode supplies its public vars and indexing
policy. Shell read origins must match the mode; a loopback HTTP fixture is the
only exception. A loopback build is for local verification and must never be
deployed. Rebuild each mode before its matching operation: output is shared.
`bun run build` is exactly the production Vite build.

`deploy:pre` invokes the pinned adapter's `vinext-cloudflare deploy --env pre`,
which selects typed config and cf. It is an owner-run operation requiring
separate authorization. It was not run on GSC_0075. There is no production
deploy script and CI contains no deployment command. Do not use legacy
platform tools, stale logins, schedule APIs or remote refreshes to verify a build.
Before an authorized deployment, review the complete generated Worker config,
bindings and secrets, reject any loopback fixture, and check the tested commit.
Production promotion and deployment remain separate owner decisions.

## Rendering and publication correctness

ISR means generating a page on demand, then refreshing it after its freshness
interval. RSC is the server component payload used for client navigation.
The bounded core is rendered during the build; empty long-tail static-parameter
lists stay empty. The official static-assets packager emits literal HTML/RSC
snapshots. The build adds a private host manifest containing mode, commit,
authoritative publication identity and the complete framework-generated tags.
The Worker denies public access to this private asset directory.

A single origin-managed adapter reads regional Workers Cache, persistent KV,
then build snapshots. Routing and locale negotiation happen before adapter
lookup. HTML/RSC/query/build/locale identities use the framework keys. There is
no independent outer response cache. Cookies, authorization, ranges, non-GET,
API and refresh requests bypass shared page reads and writes. Snapshots and
rendered responses receive the original security headers, including script
policy self plus unsafe-inline. Fonts are packaged locally; the language
switcher still goes through `/api/lang` and all seven locales remain supported.

A publication fence is a strong version check before serving a cached core
page. Every request captures the existing `views/latest.json`,
`bootstrap/latest.json` and `live/latest.json` directly from the DATA binding,
including body, publication timestamps and ETags. Public CDN and KV pointers
never decide that identity. Missing pointers have a stable explicit absence;
unreadable or invalid pointers fail closed. Rendering reads the same captured
pointers instead of process/shared pointer memos. Cached data is namespaced by
publication identity, so lagged positive/negative KV values cannot refill a new
publication with old pointer data. Core output is fully consumed and rechecked
before serving; a concurrent publication retries once, then returns 503.
Cache writes also recheck the captured identity. Rollback to an original run
has a new transition identity, preserving the existing writers' timestamps and
compare-and-swap safeguards. No writer or source-of-truth storage is replaced.

Tail pages stay fresh for 604,800 seconds, may serve stale while regenerating
for another 86,400 seconds, and then block on regeneration. Ordinary publication
does not flush warm tail pages. An explicit path/tag still invalidates them.
The actual publication operation awaits two global tags and all 56 core paths
across both cache layers, including outside a framework fetch lifecycle.

Artifact keys are hashed; entry sizes, codecs and tag counts are bounded.
Binary payloads use base64, tag reads batch at 100 keys, regional retention is
capped at one day, and KV entries retain for 30 days. Regional read/write errors
fall back to KV; persistent failures fall back to rendering. Invalidation writes
serialize per key, retry with backoff, and report a final error to the publisher.
The strong publication fence covers distributed KV lag for publication; targeted
manual tag invalidation still inherits KV's eventual consistency.
`x-gsc-cache` reports `SNAPSHOT`, `HIT`, `MISS`, `STALE` or `BYPASS`.

## Verification and delivery boundary

The PR records an exact-head detached-checkout bootstrap, full static block,
full offline web coverage suite, both local Vite builds, artifact validation,
local HTTP/browser checks and English/Japanese screenshot pairs.
`web/scripts/verify-host-local.ts` checks only a loopback preview origin;
`web/scripts/local-view-fixture.ts` serves the existing checked-in fixtures
read-only after the empty build fixture is stopped. Some existing unsuffixed
repository/ranking metadata image URLs remain 404; generated suffixed handlers
are verified as real 1200 x 630 PNGs, including known and unknown repository
fallback behavior. This predates the host migration and remains a separate fix. Tests cover
publication/rollback, stale regional KV reads, late writes, cache failure,
HTML/RSC separation, freshness/expiry, tag/layout invalidation, binding isolation,
R2 conditional writes, Queue retries, scheduled dispatch and self-reference.
Local fixtures do not certify multi-region service latency, service limits or
production load. The two beta toolchain packages remain a release risk.
The executor hands off for independent review and owner visual acceptance;
this card authorizes neither merge nor deployment.
