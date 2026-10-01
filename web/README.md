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

Production and preview run on Cloudflare Workers through OpenNext. Deploy and rollback commands are in [docs/OPS.md](../docs/OPS.md). Do not use a Vercel deploy command for the current site.

- Production Worker `gitstarclub-web` serves `gitstarclub.com`. It still reads Vercel Blob until cutover. See [docs/R2-CUTOVER.md](../docs/R2-CUTOVER.md).
- Preview Worker `gitstarclub-web-pre` (`wrangler` env `pre`) serves public `https://pre.gitstarclub.com`. It reads Cloudflare R2 and does not use `BLOB_*`.
- Preview is `noindex,nofollow` with `robots.txt` `Disallow: /`. That is not access control. There is no login wall.

A blob read or blob write, until cutover, needs `BLOB_BASE_URL`. A blob write also needs `BLOB_READ_WRITE_TOKEN`. Preview R2 reads need `R2_PUBLIC_BASE_URL` and do not need the blob token. Cron and managed refresh execution need `CRON_SECRET` and `GITHUB_TOKEN`.

## Analytics

The Cloudflare host does not load Vercel Web Analytics. `web/lib/analytics-policy.ts` returns no provider when `HOSTING_TARGET=cf` and `VERCEL_ENV` is not `production`. Google Analytics and other third-party tracking scripts are intentionally unsupported.
