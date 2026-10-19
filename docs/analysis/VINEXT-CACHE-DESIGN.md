---
owner: architecture
status: active
last_reviewed: 2026-10-19
source_of_truth_for:
  - local vinext hybrid cache proof
  - proposed vinext cache migration requirements
---

# vinext core snapshots and long-tail cache design

This is GSC_0074 / [issue #674](https://github.com/jasonhnd/gitstarclub.com/issues/674),
the local proof following GSC_0065. It is a migration design and evidence record;
the deployed site still uses the architecture described in [ARCHITECTURE.md](../ARCHITECTURE.md).
No deployment, remote refresh, or Cloudflare resource query or mutation occurred.

## Decision and proof boundary

Use an **origin-managed hybrid page adapter**: read literal build snapshots for
the bounded core; store generated page artifacts in Workers KV; accelerate reads
with Workers Cache API. All three layers share framework artifact identities and
invalidation rules. Keep a separate KV data adapter for cached JSON/function
results. Replace the PR #652 outer page-cache wrapper on the vinext path.

ISR means generating a page on demand and refreshing it after its freshness
interval. RSC is the React Server Component payload used for navigation. KV is
Cloudflare's persistent key/value cache; Cache API is the regional Worker cache.
A tag names cached content that should expire together. A path invalidation
expires artifacts for a URL. A publication fence is a version check made before
serving cached content, so an old cache cannot hide a newer publication.

The prototype demonstrates both required rendering modes on the actual web/
application, with no runtime database. **Production also needs a publication
fence against the existing authoritative JSON pointers.** KV invalidation alone
cannot promise immediate global visibility or this repository's strict
60-second visibility target. The fence and distributed failure tests remain
mandatory GSC_0075 work; they were not certified by this local simulator.

Do not select Response Store. Its R2 plus SQLite Durable Object architecture
adds a runtime database, which [ARCHITECTURE.md](../ARCHITECTURE.md) forbids.
Cache API/KV can implement the hybrid; a stronger fence can read the existing
JSON publication pointers without introducing a database. If that implementation
cannot satisfy acceptance, stop and report the limitation instead of silently
substituting Response Store.

## Reproducible artifact

- Baseline: origin/pre **e22e40d6f094e29f7e1f67aeaf63d4740066bf3e**.
- Prototype branch: **spike/GSC_0074-vinext-cache**; no pull request for its code.
- Prototype head: **7bef6ba08a1d07b1076cdb673d36be02e7eaced8**.
- [Prototype source](https://github.com/jasonhnd/gitstarclub.com/tree/7bef6ba08a1d07b1076cdb673d36be02e7eaced8/web/spike)
  includes the adapter, fixture, tests, measurements runner, and reproduction README.
- [Vite config](https://github.com/jasonhnd/gitstarclub.com/blob/7bef6ba08a1d07b1076cdb673d36be02e7eaced8/web/vite.config.ts)
  combines the official snapshot packager with the custom writable runtime.
- [Typed local Worker config](https://github.com/jasonhnd/gitstarclub.com/blob/7bef6ba08a1d07b1076cdb673d36be02e7eaced8/web/cloudflare.config.ts)
  declares only local assets, KV, and fixture/string values. It has no account,
  production resources, R2 cache bucket, Durable Object, queue, domain, or schedule.

The prototype was made in an isolated clone inside this card's temporary
directory. Its commits are separate from this documentation PR. The temporary
checkout, downloads, builds, empty credential-free HOME, simulator state, and
logs all stay under `.kanban-work/GSC_0074/`, excluded through local Git metadata.
No owner's environment files were copied. The proof fixture uses the repository's
existing example/repo JSON; it does not expand product data coverage.

| Package | Exact prototype version |
|---|---|
| vinext | 1.2.1 |
| @vinext/cloudflare | 1.1.1 |
| Vite | 8.3.0 |
| @cloudflare/vite-plugin | 2.0.0-beta.v.2 |
| cf | 1.0.0-beta.18 |
| React / React DOM / react-server-dom-webpack | 19.3.1 / 19.3.1 / 19.3.1 |
| @vitejs/plugin-rsc / @vitejs/plugin-react | 0.5.37 / 6.0.1 |

`spike/check-graph.ts` parses **all 681 package nodes** in the committed Bun
lock graph, rejects direct/nested Wrangler resolutions, checks installed
versions, and asserts that neither Wrangler nor OpenNext is installed in the
prototype. It passed. The v2 plugin and cf pins matter: the stable v1 plugin
would reintroduce Wrangler transitively. Next remains installed for existing
types/lint compatibility; Vite supplies the runtime build.

The adapter package unconditionally depends on
`@cloudflare/workers-response-store@1.1.1`. That library's presence is not use of
its backend: the proof never imports its adapter, configures its bindings, or
instantiates its SQLite Durable Object. No Wrangler or OpenNext executable,
including their build/preview/dry-run scripts, was run. The unchanged Next
baseline used for the required documentation gate still has its legacy packages;
the Wrangler-free graph claim applies to the isolated prototype, not that baseline.

## Request and storage flow

```text
request -> Worker -> vinext proxy/routing (including language negotiation)
                  -> credential/range/method bypass, or page adapter lookup
                     -> Cache API artifact + KV tag validation
                     -> KV artifact + KV tag validation
                     -> build snapshot + KV tag validation
                     -> render from precomputed JSON -> KV + Cache API
```

The prototype uses the public `vinext/server/fetch-handler` entry. Native vinext
routing runs before artifact lookup, so a cached English home cannot suppress a
Japanese redirect. The Worker wrapper adds observability and the existing
security headers; it does not serve page hits before the proxy.

**Build snapshots.** `prerender: { routes: "*", concurrency: 2 }` discovers bounded
paths. Existing empty long-tail `generateStaticParams()` lists stay empty. The
official static-assets adapter's build finalizer packages HTML/RSC artifacts;
the custom runtime reads them through ASSETS. It does not merely warm a running
server after a build. The final build rendered **241 routes**, skipped **30**,
and packaged **481 artifacts: 241 HTML and 240 RSC**. `/example/repo` was absent
from the prerender manifest. The home response was byte-identical to the private
build HTML file, SHA-256
`635a8965a0a783fd5abe8ef2c502806e66db06ed2cfa877c5e147cf3ca96c7e1`.
Build identifiers and hashes change on another build.

**Writable artifacts.** Framework keys include build identity and the HTML/RSC
representation. SHA-256 bounds storage keys. Runtime entries contain the value,
timestamp, freshness policy, and tags; ArrayBuffers round-trip through the proof
codec. Cache API retention is capped at **86,400 seconds**, retaining the old
outer cache's physical cap. KV retains page artifacts for **30 days**, so a
regional eviction need not rerender a still-fresh seven-day page. KV data cache
keys have a separate prefix. Neither cache is the source of truth for site data.

**Seven-day page policy.** The adapter explicitly assigns long-tail pages
**604,800 seconds fresh, another 86,400 seconds stale, then blocking regeneration**.
An expired entry is not served. A stale request may receive the old artifact while
vinext regenerates it in the background. This is a page policy, separate from
the JSON data cache's shorter freshness. It is not a claim that merely retaining
the existing route export yields seven days under vinext.

**Publication and rollback.** The proof calls the real
`web/lib/workflows/publication-cache.ts::invalidatePublishedViews`, with an awaited
port to vinext's `revalidateTag` and `revalidatePath`. Both local transitions
invalidate `published-views-pointer`, `bootstrap-publication-pointer`, and all
**56 core paths**, with `{ expire: 0 }` for the two data tags. Core snapshot path
tags are checked against the same persistent ledger as runtime entries. Invalid
KV/hot entries cannot fall back to a snapshot invalidated by a newer path marker.
The adapter also rejects a write when a relevant marker changed during rendering.

Long-tail page entries deliberately omit the two global pointer tags. Their
immutable JSON selection can remain visible until the page's seven-day refresh,
as the existing publication function's contract requires. A cold long-tail URL
reads the current publication; an explicit path or targeted tag can refresh a
warm one. Core invalidation does not purge the entire root layout. RSC and HTML
are separate artifacts with shared path/tag invalidation.

The proof's timestamp ledger is deliberately small. Production needs bounded
tag batches, complete ancestor/layout tags for snapshots, malformed-entry
validation, efficient binary encoding, per-environment/deployment namespaces,
cache-error fallback, retention limits, and concurrent-render/load tests.
Its abbreviated path classifier is not a production route registry.

## Outer edge cache and locale decision

Retire `handleEdgeCachedNext` from the vinext fetch path. Reusing the old outer
wrapper would add an independent response store which native `revalidatePath`
cannot purge and could return before locale routing. Adding raw Accept-Language
to that outer key alone would still fragment equivalent languages and leave
cookie/routing/other invalidation behavior split across two layers.

Use one adapter after routing instead. Explicit locale paths own their own
artifacts; cookie, authorization, range, and non-GET requests bypass shared page
reads and writes. Preserve query and RSC transport isolation through framework
keys. In particular, vinext canonicalizes `_rsc`; the successful RSC probes use
the canonical `?_rsc` with `RSC: 1`. An arbitrary `_rsc=proof` correctly returned
a 307 canonicalization redirect during investigation.

Preserve `x-gsc-cache: HIT|MISS|BYPASS`, and document the useful added states
`SNAPSHOT` and `STALE`. The prototype's `x-spike-layer`, timestamp, and clock
headers are diagnostics to remove. Keep Worker-first routing for public/private
cache files, with hashed build assets excluded; the private snapshot index
returned 404. The wrapper reapplies the existing CSP (browser script/style
source restrictions) to snapshots because the first snapshot probe omitted
the Next config security headers. Script policy remains self plus unsafe-inline.

## Measurements

These are single local requests in Vite preview's workerd runtime, including
response-body consumption, on macOS arm64 with Node 24.20.0 and Bun 1.4.2.
They are evidence of behavior, not production latency estimates. Seven/eight-day
boundaries use a **test clock offset**, not seven days of wall-clock observation.
Hot eviction is explicit local Cache API deletion, not a simulated region.

| Probe | HTTP / adapter result | Layer or effect | Elapsed ms |
|---|---|---|---:|
| Home first request | 200 / SNAPSHOT | Literal build HTML | 10.28 |
| Japanese home after English hit | 307 / BYPASS | Location `/ja` | 3.71 |
| Core RSC | 200 / SNAPSHOT | `text/x-component`, separate bytes | 6.63 |
| Repository cold | 200 / MISS | Runtime render | 102.53 |
| Repository warm | 200 / HIT | Cache API, identical HTML | 7.40 |
| Repository RSC | 200 / HIT | Separate RSC artifact | 30.97 |
| Hot artifact evicted | 200 / HIT | KV, identical HTML | 7.66 |
| Age 604,799 seconds | 200 / HIT | Still fresh | 6.77 |
| Age 604,801 seconds | 200 / STALE | Background regeneration starts | 38.83 |
| After regeneration | 200 / HIT | New artifact timestamp | 9.22 |
| Age 691,201 seconds on a fresh seed | 200 / MISS | Hard expiry blocks old output | 34.20 |
| Core after publish | 200 / MISS | Snapshot rejected; new content | 116.17 |
| Core next request | 200 / HIT | Mutable artifact | 6.91 |
| Cold Japanese repo after publish | 200 / MISS | New run-b description | 46.09 |
| Core after rollback | 200 / MISS | Regenerated run-a content | 106.83 |
| Warm Japanese repo after rollback | 200 / HIT | Retains run-b HTML until TTL | 7.37 |
| Targeted Japanese repo path invalidation | 200 / MISS | Replaced with run-a content | 66.12 |
| Japanese home after mutable hit | 307 / BYPASS | Location `/ja` | 3.45 |

All **33 HTTP assertions passed**, including static query identity, private
artifact denial, language-cookie redirects, cookie/auth/range bypass, and
`unstable_cache` data-tag invalidation. Each publish/rollback returned the actual
58 operations. Warm tail bytes remained unchanged across publication; the cold
localized tail contained the new fixture description. Rollback left that warm
localized tail on its TTL; targeted invalidation restored the old description.

All **6 adapter tests passed** (13 assertions): real snapshot invalidation even
with a new adapter instance; fresh/stale/expired boundaries; hot-cache tag
invalidation; pointer tags versus tail TTL; credential bypass; and invalidation
during rendering. These supplement, rather than replace, the full repository gate.

## Distributed correctness and required fence

Cloudflare documents Cache API contents as local to a data center, with local
deletion rather than global deletion. A hot hit here still checks KV markers;
there is no second independent purge protocol.
[Cache API reference](https://developers.cloudflare.com/workers/runtime-apis/cache/).

KV changes and negative lookups are eventually consistent. Other locations may
see old values for 60 seconds or longer; even same-location immediate visibility
is not guaranteed. Setting the adapter's in-process tag cache to zero does not
remove KV's own caching. These local tests cannot establish a global 60-second
bound. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

GSC_0075 must therefore fence mutable core artifacts and pointer-dependent data
entries with the current authoritative publication identity, read through the
existing R2 DATA binding rather than a cached public URL. Record that identity
in the build snapshot manifest. Use the effective managed/bootstrap publication
selection and a transition identity that changes on **rollback as well as publish**;
an old run ID alone is insufficient. Existing pointer ETags plus publication
timestamps can supply this without adding a runtime database or a response-cache
R2 bucket. A new identity rejects old runtime artifacts and build snapshots,
including when KV tag reads lag. Propagate the same identity to the data-cache
namespace and invalidate/reset pointer memos before rendering; fencing only HTML
could otherwise refill a new namespace with stale pointer data.

The publication writer's compare-and-swap safeguards (replace the pointer only
when its prior version still matches) remain unchanged. Bind each render to its
captured identity and recheck before admitting it. On a fence-read failure,
do not serve an artifact whose publication cannot be established. Test stale
positive/negative KV reads, old-region writes after publish, a rollback to the
build's original run, and core HTML/RSC together. This is a required implementation
design, not measured R2 behavior on this card. Keep long-tail page namespaces
independent so ordinary publication still preserves their seven-day contract.

KV also limits writes to a single key to once per second. Publication followed
quickly by rollback needs serialized/retried marker writes and observable
post-commit failures; local Miniflare does not certify those service limits.
[KV limits](https://developers.cloudflare.com/kv/platform/limits/).

## Reproduction and baseline verification

Use the prototype commit above in an isolated checkout under the current card's
temporary directory, with no copied .env files or credentials. Run the AGENTS.md
checksum-verified bootstrap with TMPDIR/KANBAN_TMP pointing there. Then from web/:

```bash
bun install --frozen-lockfile --ignore-scripts
bun spike/check-graph.ts
bun spike/patch-workers-fetch.ts
```

Run the local fixture in a separate terminal and leave it running:

```bash
bun spike/fixture.ts
```

Set BLOB_BASE_URL=http://127.0.0.1:4074, SITE_INDEXABLE=0, and the card-local
GSC_SPIKE_TMP output directory, then:

```bash
bun run build
bun test spike/hybrid.test.ts
bun run start -- --host 127.0.0.1 --port 4174
```

The build/start scripts are exactly `vite build` / `vite preview`. From another
terminal with the same environment run `bun spike/measure.ts`. It writes the
33 records, body hashes, headers, and local timings to the temporary directory.
Stop the fixture and preview afterward. No Cloudflare account or login is needed.
Port 4074 was chosen because another process owned 4010; that process was not touched.

The documentation PR also runs the AGENTS.md bootstrap, complete offline static
job, and fixture Next production build in a fresh detached checkout of its exact
head. Its PR body and kanban handoff record each command and result. This gate
checks the unchanged application baseline plus documentation; it does not claim
that the throwaway migration passes every existing OpenNext-specific test.
GitHub Actions stays disabled. **cf:dry-run is skipped by owner order**, along
with all other forbidden Wrangler/OpenNext platform build or deploy commands.

## GSC_0075 implementation checklist

The GSC_0065 estimate was 10-19 engineer-days; this proof resolves the basic
hybrid feasibility but adds explicit fetch/header/freshness and fence work.
Do not treat the throwaway adapter as production-ready or remove these gates.

1. **Dependencies and Vite configuration (inventory 1-2, 4).** Remove direct
   and transitive Wrangler/OpenNext; pin this Vite v2/cf closure and matching
   patched React packages. Add the graph gate. Keep types/lint tools only when
   still needed. The 1.2.1 native-fetch issue requires an upstream fix or a
   pinned, tested compatibility patch: its fetch shim implements `force-cache`
   and then forwards that unsupported value to native workerd Request/fetch.
   The prototype patch normalizes only native options and was necessary to
   turn actual repo requests from 500 into 200.
2. **Hybrid adapter and build inventory.** Implement typed, bounded codecs,
   route classification, complete snapshot tags, fresh/stale/expiry policies,
   and the publication fence above. Preserve separate HTML/RSC/build/locale
   identities, cookie/auth/range/API/refresh bypass, private-asset denial, and
   failure/race handling. Explicitly separate the seven-day tail page lifetime
   from data fetch TTL: unmodified repo requests actually cached for 86,400
   seconds, and regenerated core HTML inherited a 60-second nested-data TTL.
3. **Publication, rollback, and host integration (inventory 6-7).** Keep the
   real publication function's two tags/56 paths and tail policy. Await invalidation
   outside route-handler lifecycle too; test Queue and scheduled paths where
   vinext's request-time adapter registration/pending-operation drain may not run.
   Preserve pointer fencing, post-commit failure reporting, self-reference,
   queue retry behavior, and paused schedules. Replace the old outer cache,
   do not stack it around the new adapter. Retain cache/build observability.
4. **Typed Worker contract (inventory 4-6).** Port the actual custom fetch,
   queue, scheduled, JOBS, DATA/MEDIA, self-reference, vars, observability,
   compatibility, and pre/production isolation contracts into cloudflare.config.ts.
   The proof config intentionally does not port these. Replace the generated
   .open-next/worker.js import and the two OpenNext context consumers with
   injectable Workers-native adapters; remove the temporary proof bridge.
5. **Scripts, artifacts, and delivery (inventory 3, 8-9).** Replace old cf build,
   preview, and dry-run scripts with explicit-target Vite builds and local
   validation; adapt identity/output/config guards. Retire old Worker config
   only under the migration card's explicit scope. Update AGENTS.md, delivery
   metadata, current architecture/development/testing/operations/SEO/data docs,
   and command references together. Preserve required gate names if automation
   is later authorized; do not enable Actions as part of this proof. Annotate
   historical OpenNext evidence rather than rewriting it as vinext history.
6. **Product/runtime regression.** Run the full web suite and local builds;
   exercise Queue/self-binding/retry fixtures, scheduled dispatch without active
   schedules, R2 conditional writes and resource identity, real PNG OG images,
   all seven locales, /api/lang, rewrites, query/RSC variants, and unchanged CSP.
   Verify security headers on both snapshots and generated responses, local font
   assets, production indexability and preview noindex. The proof did not certify
   browser hydration, visual parity, OG bytes, production limits, or multi-region
   performance. UI changes require the repository's screenshots/owner signoff.
7. **Remove proof surfaces and prepare review.** Delete the local controls,
   clock override, fixture-only Worker, diagnostics, temporary context bridge,
   and package patch if superseded. Keep no runtime database, no new coverage,
   and no production authorization inferred from preview permission. Production
   still requires Jason's explicit approval. Executor hands off; reviewer/owner
   decides merge. This card authorizes no deployment.

## Published implementation references

Versioned source packages, integrity-verified before inspection:
[vinext 1.2.1](https://registry.npmjs.org/vinext/-/vinext-1.2.1.tgz),
[Cloudflare adapter 1.1.1](https://registry.npmjs.org/@vinext/cloudflare/-/cloudflare-1.1.1.tgz).
Relevant package-relative files are `dist/config/prerender.js`,
`dist/server/isr-cache.js`, `dist/shims/cache.js`, `dist/shims/fetch-cache.js`,
and the adapter's `dist/cache/static-assets-adapter{,.build,.runtime}.js`,
`kv-data-adapter.runtime.js`, and `workers-cache-cdn-adapter.js`.

The stock static-assets runtime has no-op set/tag invalidation. The stock Workers
Cache adapter uses uncached request routing plus named response entrypoints;
the custom prototype instead owns artifact reads inside the application Worker.
The [official cache guide](https://vinext.dev/docs/guides/caching) describes these
distinct choices. A stock adapter configuration alone does not prove this hybrid.
