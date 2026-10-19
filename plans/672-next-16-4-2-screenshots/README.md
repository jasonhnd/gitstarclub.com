# Issue 672: Next.js 16.4.2 screenshot evidence

Captured on 2026-10-19 with agent-browser 0.39.1 and local Chrome, light theme,
a 1440 x 1000 viewport, and full-page PNG output. Each pair has identical pixels.
All six routes returned HTTP 200 and the browser reported no page-script errors.

- Before: `origin/pre` at `39f42af0e2bf15fb67e9c02c258d5583ee1b4b0e`, Next.js 16.3.8.
- After: application code and dependencies at `af404a8`, Next.js 16.4.2. The
  following evidence commit adds only this directory and plan wording.
- Both builds used Node 24.20.0, Bun 1.3.14, a frozen install, and
  `BLOB_BASE_URL=http://127.0.0.1:4010 bun run build` against the repository's
  read-only `web/scripts/ci-build-fixture-server.ts`.
- Each build was served with `bun run start --hostname 127.0.0.1 --port 3000`
  and the same loopback read base. For runtime visual checks, the included
  GET/HEAD-only server exposes the existing `web/scripts/fixtures/views/`
  files. This lets the monthly ranking and `example/repo` render real page
  components, including honest empty sections, without live data or new data
  coverage. Missing fixture files remain 404. The home pages also exercise
  prerendered empty states and normal regeneration against these fixtures.
- Service workers and browser caches were cleared between versions. Captures
  waited for network idle and loaded fonts.

| Page | Route | Before | After |
| --- | --- | --- | --- |
| Home, English | `/` | [PNG](before-home-en.png) | [PNG](after-home-en.png) |
| Home, Japanese | `/ja` | [PNG](before-home-ja.png) | [PNG](after-home-ja.png) |
| Monthly ranking, English | `/rankings/2026/07` | [PNG](before-ranking-en.png) | [PNG](after-ranking-en.png) |
| Monthly ranking, Japanese | `/ja/rankings/2026/07` | [PNG](before-ranking-ja.png) | [PNG](after-ranking-ja.png) |
| Repository, English | `/example/repo` | [PNG](before-repo-en.png) | [PNG](after-repo-en.png) |
| Repository, Japanese | `/ja/example/repo` | [PNG](before-repo-ja.png) | [PNG](after-repo-ja.png) |

## Reproduce the runtime fixture

After building with the standard read-only CI fixture, stop that fixture. From
the checkout root, use the pinned Bun toolchain in a clean environment:

```bash
VISUAL_FIXTURE_ROOT="$PWD/web/scripts/fixtures/views" \
  bun plans/672-next-16-4-2-screenshots/fixture-server.ts
```

In a second clean shell, start the built application:

```bash
cd web
BLOB_BASE_URL=http://127.0.0.1:4010 \
  bun run start --hostname 127.0.0.1 --port 3000
```

Use an isolated browser profile beneath the current card's temporary directory.
No Cloudflare build, Wrangler command, deployment, or remote data mutation is
part of this evidence. These screenshots support the independent review; they
are not owner visual acceptance or a Worker runtime compatibility check.
