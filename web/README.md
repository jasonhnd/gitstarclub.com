# GitStarClub Web

Next.js 16 App Router application for GitStarClub.

## Local Development

```powershell
bun install
bun dev
```

Open `http://localhost:3000`.

Required local secrets live in `web/.env.local` and must not be committed.

## Hosting

Production and preview run on Cloudflare Workers through vinext. Deploy and rollback commands are in [docs/OPS.md](../docs/OPS.md). Do not use a Vercel deploy command for the current site.

- Production Worker `gitstarclub-web` serves `gitstarclub.com`. It uses R2 after the accepted 2026-10-04 cutover. See [docs/R2-CUTOVER.md](../docs/R2-CUTOVER.md).
- Preview Worker `gitstarclub-web-pre` (`typed configuration` env `pre`) serves public `https://pre.gitstarclub.com`. It reads Cloudflare R2 and does not use `BLOB_*`.
- Preview is `noindex,nofollow` with `robots.txt` `Disallow: /`. That is not access control. There is no login wall.

Both Worker contracts use R2. Read-only R2 builds need the explicit R2 driver and matching public base; production prerender preserves the frozen fallback until its views pointer is authoritative. The retained Blob driver needs `BLOB_BASE_URL` for reads and a Blob token for writes. R2 public reads do not need that token. Cron and managed refresh execution need `CRON_SECRET` and `GITHUB_TOKEN`.

## Analytics

The application has no analytics provider or analytics scripts. Google Analytics and other third-party tracking scripts are intentionally unsupported. Privacy copy in all seven locales describes this behavior and the essential language-preference cookie.
