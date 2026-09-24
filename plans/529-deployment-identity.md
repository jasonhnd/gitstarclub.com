# Issue 529 plan

1. Generate a shared commit identity before the Cloudflare OpenNext build, using the CI override or Git HEAD and marking dirty worktrees.
2. Use the shared identity after the existing environment overrides in both deployment routes.
3. Test identity priority and missing Git, update the API and operations notes, then run the required build and checks.
4. Commit, push the issue branch, and open a PR against `pre`. Manual preview deployment and endpoint verification remain operator steps.
