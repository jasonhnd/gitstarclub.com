# Issue 743: diagnose preview's empty monthly history

## Goal

Explain the 2026-10-25 managed-refresh preflight failure using code, tests and
operational documentation, with verified facts distinguished from inference.

## Scope

Trace cold start, monthly folding, weekly cron, aggregate import and bootstrap
publication routing. Write a short root DIAGNOSIS.md answering the five card
questions and listing independently scoped follow-up cards with size and risk.
Use only local reads and, if needed, public GET requests on data-pre.

## Out of scope

No application code, configuration or test changes; no deployment, data writes,
refresh execution, secret access, production access or repository relocation.

## Acceptance

DIAGNOSIS.md cites file/line evidence for writers, import routing, weekly cron,
empty-history legitimacy and the smallest follow-ups. Mark every finding as
verified by source/test read or inferred; separate any Mac deployment/data work.
No tests are required for this read-only diagnosis; review the documentation diff.
