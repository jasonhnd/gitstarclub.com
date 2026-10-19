# Local vinext cache proof

This is throwaway GSC_0074 code, based on pre e22e40d. Do not deploy it or open
a product PR for it. It deliberately replaces the real Worker shell with a
local proof entry. Queue, scheduled, production binding, and deployment parity
are work for GSC_0075. The documentation PR contains the maintained decision.

Use the checksum-verified Node 24.20.0 and Bun 1.4.2 toolchain from AGENTS.md.
Set TMPDIR and KANBAN_TMP to the current card's .kanban-work/GSC_0074 directory;
use an empty HOME there, with no credentials. From web/:

```bash
bun install --frozen-lockfile --ignore-scripts
bun spike/check-graph.ts
bun spike/patch-workers-fetch.ts
```

The graph checker asserts the requested five pinned versions and inspects all
681 lock nodes for Wrangler, including transitive resolutions. The fetch patch
has a pinned-source assertion. It strips unsupported native cache options only
after vinext has made its own cache decision.

Run the JSON fixture in a separate local foreground terminal, then keep it
running for the build and measurements:

```bash
bun spike/fixture.ts
```

With BLOB_BASE_URL=http://127.0.0.1:4074 and SITE_INDEXABLE=0:

```bash
bun run build
bun test spike/hybrid.test.ts
bun run start -- --host 127.0.0.1 --port 4174
```

The last command is Vite preview running local workerd. In another terminal,
with the same environment and GSC_SPIKE_TMP pointing to the card directory:

```bash
bun spike/measure.ts
```

Expect 6 passing unit tests and 33 passing HTTP measurements. The runner clears
only this local simulator's cache, switches the local JSON fixture between
run-a and run-b, and calls the application's invalidatePublishedViews function
through a proof-only route. Clock offsets simulate seven-day freshness and
eight-day hard expiry; this is not a week-long observation. Stop both foreground
servers when finished.

The route /api/spike, x-spike-clock-ms header, diagnostic headers, test fixture,
temporary OpenNext context bridge, and abbreviated path classifier must never
ship. The full migration must implement the typed and hardened adapter described
in docs/analysis/VINEXT-CACHE-DESIGN.md on the documentation branch. Stock Static
Assets alone has no mutable invalidation, and this custom origin-managed
adapter is not the stock named-entrypoint Workers Cache adapter.
