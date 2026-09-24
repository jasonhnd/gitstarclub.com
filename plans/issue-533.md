# Issue 533: Restore production indexing

1. Set the production build and Worker runtime indexing variables while keeping the preview build closed to crawlers.
2. Add a configuration gate that rejects a missing production flag or an enabled preview flag.
3. Update operations and SEO guidance, then run the issue checks and open a PR against `pre`.

The owner must deploy the production build manually and verify both production and preview SEO responses before resubmitting the production sitemap.
