# Branch policy (hard stop)

Unless the user explicitly says **push main** / **推到 main** / **promote to main**:

- Implement, open PRs, merge, and rebase only against **`pre`**.
- Do not target `main`. Do not cherry-pick onto `main`. Do not merge or push `main`.
- Do not hotfix production because Vercel cron runs on `main`. Land on `pre` and wait.
- Do not call production cron (`gitstarclub.com/api/cron/*`) to ship a code change.

合 = merge to `pre`. 继续 = next ticket on `pre`.
