# Issue 529 plan

1. Resolve the commit identity before the Cloudflare OpenNext build, using the CI override or Git HEAD and marking dirty worktrees. Write it to a gitignored module that shadows a committed null fallback for both the Next app and Worker shell.
2. Use the shared identity after the existing environment overrides in both deployment routes.
3. Test identity priority, missing Git, and two clean consecutive generations; update the API and operations notes, then run the required checks.
4. Commit and push the issue branch to update PR #534 against `pre`. Manual preview deployment and endpoint verification remain operator steps.
