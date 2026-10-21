# Astro migration gate 0

This independently locked application proves host mechanisms before Product page
specs arrive. It does not replace the current `web/` application. Follow
[the migration plan](../plans/astro-migration.md) and root AGENTS.md.

Use checksum-verified Node v24.20.0 and Bun 1.4.2. Set `KANBAN_TMP` and `TMPDIR`
to the current card's absolute scratch directory before running:

```bash
bun install --frozen-lockfile
bun run validate:graph
bun run typecheck
bun run test
bun run build
bun run test:worker
```

Build/type-generation output is linked into KANBAN_TMP. Dependencies use Bun's
shared install cache. Install `web/` dependencies too: framework-independent
contracts and locale/publication helpers are imported directly, so they have one
source and keep their existing tests. No owner environment file is needed.

Astro 7.4.1 is stable. The official cf-based Cloudflare adapter 15.0.0-beta.3
and Vite plugin 2.0.0-beta.v.3 are prereleases; the graph check rejects Wrangler.
The cf 1.0.0-beta.18 pin matches the existing host and supports the prescribed
Node runtime. All resource names in the new typed config are local fixtures.
There is no deployment script. Do not deploy these artifacts.
