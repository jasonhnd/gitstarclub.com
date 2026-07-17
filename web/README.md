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
- Preview: public `pre.gitstarclub.com`, always noindex

Run deploy commands from the repository root, not from `web/`, because the
Vercel project already appends the `web` root directory.

```powershell
vercel deploy . --prod --yes --scope zkscio --project gitstarclub.com
vercel deploy . --yes --scope zkscio --project gitstarclub.com
```

Production and Preview read paths need `BLOB_BASE_URL`. Mutation paths additionally
need `BLOB_READ_WRITE_TOKEN`; scheduled cron/workflow execution also needs
`CRON_SECRET` and `GITHUB_TOKEN`. Preview Protection is a dashboard-managed option,
not a repository-enforced property; the current fixed staging domain is public.

## Analytics

Web traffic is measured with [Vercel Web Analytics](https://vercel.com/docs/analytics)
via the `@vercel/analytics` package (`<Analytics />` in `app/_shell/RootShell.tsx`).
Vercel Web Analytics is cookieless and collects no personal data. Collection only
starts once **Web Analytics** is enabled for the project in the Vercel dashboard.
Its script and reporting endpoint are same-origin under `/_vercel/insights`, and
the build fails if the Content Security Policy would block those endpoints.
Google Analytics and other third-party tracking scripts are intentionally unsupported.
