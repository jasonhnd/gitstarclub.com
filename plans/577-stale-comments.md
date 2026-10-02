# 577 stale comments

## Goal

Correct comments named by issue #577 from audit findings A03 and B05. Comments only. No config value, export, or runtime behavior changes.

## Scope

- Worker config comment that still calls the Vercel cron file the production scheduler (A03). The public Blob base comment already says preview uses its own R2 origin and does not share that store. Leave that comment as it is.
- Worker env JSDoc that says the DATA binding is not wired yet (B05). Preview wires DATA. Production does not.
- OpenNext config comment that calls the file a preview-only host (B05).
- View source header that says every read is the Vercel Blob store (B05).
- Backfill step 5 and step 7 headers that call recompute and export Vercel-only (B05).
- Analytics policy comment that limits the Cloudflare off switch to the preview host. The function turns the provider off whenever the hosting target is Cloudflare and the Vercel environment is not production.

## Out of scope

- Docs pages from the same findings. Other cards own those.
- `triggers.crons`, bucket names, vars, drivers, and analytics return values.
- CI workflows, delivery config, and deploy scripts.
- Dependency audits already tracked on issue #584.

## Acceptance

- `git diff` against origin/pre changes comment lines only.
- A fresh detached worktree of the commit passes the AGENTS.md static job, including the fixture production build and the pre dry-run.
- One pull request into pre. Do not merge.
