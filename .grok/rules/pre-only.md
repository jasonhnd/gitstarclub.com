# Branch policy (hard stop)

`pre` is the integration branch. Every feature branch and every pull request is based on `pre`. `main` is production.

Implement and open feature pull requests only against `pre`. Rebase feature branches only onto `pre`.

Promotion is a separate pull request from `pre` to `main`. Merge that pull request with a merge commit so `Closes #N` keeps working. Open it only when the owner explicitly says "push main", "push to main", or "promote to main".

Never push directly to `pre` or `main`. The ruleset `release gates (pre/main)` requires a pull request, blocks a force-push, and blocks deleting those branches. Do not target `main`, cherry-pick onto `main`, merge into `main`, or push `main` unless the owner explicitly orders it.

Do not hotfix production by calling production cron. Land on `pre` and wait. Do not call production cron (`gitstarclub.com/api/cron/*`) to ship a code change.

Required status checks are `static` and `production-build` (the job names in `.github/workflows/ci.yml`; `.delivery.yml` lists the same two). `preview-e2e`, `product-gates`, `cf-preview`, and `cf-workers-host` are optional. Do not make them required.

Feature pull requests into `pre` are squash-merged by the reviewer or owner, never by the executor. Merging to `pre` is allowed for that reviewer or owner. Merging to `main` is not automatic.

Unless that promotion pull request was explicitly ordered, merge means merge to `pre`. Continue means the next ticket stays on `pre`.
