# Issue 745: preview history availability

## Goal

Represent the preview seed's unavailable monthly net history and prior-calendar-year
heatmap explicitly while keeping the default and every production deployment strict.

## Scope

1. Define a strict marker schema beside the existing canonical metadata schema.
2. Add a pure reader beside the canonical validation policy. Reuse the existing
   preview deployment guard and accept only a validated, explicit marker.
3. Test missing and malformed markers, deployment guards, Worker bindings, and
   declared coverage. Document the marker and operator authorization in `docs/OPS.md`.
4. Commit the completed implementation and run the requested tests and repository
   static checks, with local fixture builds when dependencies are available.

The marker is a separate `canonical/v2/history-availability.json` object. Keeping
it separate preserves the existing metadata contract and lets invalid marker data
fall back to strict independently of canonical metadata parsing.

## Out of scope

- Connecting the marker to preflight, canonical validation, or publication gates.
- Setting a live marker, service calls, deployment, secrets, platform commands,
  or changes to Worker configuration and CI.
- Restoring cold-start flags, fabricating monthly rows, or deriving monthly net
  values from aggregate history.

## Acceptance

- Missing or invalid markers return `strict`; empty families and fold watermarks
  never establish eligibility.
- A valid marker returns its declared unavailable coverage only with explicit
  preview deployment and no production signal, including native Worker bindings.
- The marker records a real seed date, both unavailable histories, and a valid
  timestamp for when it was set.
- Operations documentation identifies authorized setters and forbids production.
- The targeted test and full offline web coverage suite pass. Verification stays
  in the existing `~/w` checkout, as required by the owner's workspace rule;
  caches and logs stay in `.kanban-work/745/`, with no environment files loaded.
