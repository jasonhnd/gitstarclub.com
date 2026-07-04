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
- Preview: `pre.gitstarclub.com` with Vercel Preview Protection

Run deploy commands from the repository root, not from `web/`, because the
Vercel project already appends the `web` root directory.

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com
vercel deploy . --yes --scope zkscio --project gitstarclub.com
```

Production and Preview both need `BLOB_BASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`CRON_SECRET`, and `GITHUB_TOKEN`.

## Analytics

Web traffic is measured with [Vercel Web Analytics](https://vercel.com/docs/analytics)
via the `@vercel/analytics` package (`<Analytics />` in `app/_shell/RootShell.tsx`).
Vercel Web Analytics is cookieless and collects no personal data. Collection only
starts once **Web Analytics** is enabled for the project in the Vercel dashboard.

Google Analytics 4 can run alongside it through the Next.js
`@next/third-parties/google` `GoogleAnalytics` component. Set `NEXT_PUBLIC_GA_ID`
to a non-empty measurement ID starting with `G-` to emit GA; when it is unset or
invalid, no GA script is rendered. Do not hardcode GA measurement IDs.
