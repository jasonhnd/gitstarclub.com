# GitStarClub Web

Next.js 16 App Router application for GitStarClub.

## Local Development

```powershell
bun install
bun dev
```

Open `http://localhost:3000`.

Required local secrets live in `web/.env.local` and must not be committed.

## Vercel

The canonical Vercel project is `zkscio/gitstarclub.com`.

- Root Directory: `web`
- Framework: Next.js
- Production: `gitstarclub.com` / `www.gitstarclub.com`
- Preview: `pre.gitstarclub.com` after Cloudflare DNS points `pre` to `76.76.21.21`

Run deploy commands from the repository root, not from `web/`, because the
Vercel project already appends the `web` root directory.

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com
vercel deploy . --yes --scope zkscio --project gitstarclub.com
```

Production and Preview both need `BLOB_BASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`CRON_SECRET`, and `GITHUB_TOKEN`.
