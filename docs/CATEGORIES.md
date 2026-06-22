# Categories

This document defines the first category system for GitStarClub. It is a
scoped, static-read plan for the current tracked repository universe, not the
full analytical filtering layer described in the roadmap.

## Scope

The category system should let readers browse repositories by stable, useful
groups such as `python`, `html`, `javascript`, `go`, and `rust`, plus broader
technical and product-oriented groupings.

Initial category work must stay compatible with the existing static JSON / ISR
architecture:

- Use deterministic rules and precomputed JSON artifacts.
- Use the current tracked whitelist as input.
- Avoid request-time database queries.
- Avoid arbitrary multi-filter combinations until the analytical data layer is
  designed.

## Non-Goals

- No expansion to all repositories above 100 stars in this phase.
- No arbitrary query-builder or faceted search backend.
- No semantic embedding, LLM, or README scraping dependency.
- No generated route for every possible low-volume tag.
- No user-editable taxonomy.

## Product Goals

The first release should support:

- Language pages such as Python, HTML, JavaScript, Go, Rust, TypeScript, Java,
  C, C++, C#, PHP, Ruby, Swift, Kotlin, Dart, Shell, CSS, Vue, and Svelte.
- Higher-level groups that are easier to scan than raw GitHub languages.
- Domain pages for common repo intents such as AI/ML, frontend, backend,
  DevTools, infrastructure, databases, security, mobile, game development, and
  blockchain.
- Stable category URLs that can be indexed by search engines.
- Category-specific rank views using the same ranking semantics as the rest of
  the product.

## Taxonomy

Each category belongs to one dimension. Category IDs use this format:

```text
<dimension>/<slug>
```

Examples:

```text
language/python
language/javascript
language_family/js-ts
domain/ai-ml
project_type/cli
ecosystem/react
maturity/star-100k
```

Slugs must be lowercase ASCII kebab-case. Labels may be title case for display.

### Dimension: language

Source: GitHub primary language plus significant secondary languages from the
GitHub language breakdown when available. Older shards fall back to GitHub
primary language.

Rules:

- Repositories always belong to their GitHub primary language when available.
- Repositories may belong to additional language categories only when a
  secondary language is a meaningful share of the repository. Tiny support-file
  languages such as small `Justfile`, `Dockerfile`, `Makefile`, `Shell`, or
  config snippets must not create category membership for an otherwise dominant
  primary-language repository.
- Normalize common display variants to stable slugs.
- Preserve unknown languages as normalized slugs only if the category has enough
  repositories to be useful.
- Use `language/unknown` only when the source language is missing.

Priority launch set:

```text
python
html
javascript
typescript
go
rust
java
c
cpp
csharp
php
ruby
swift
kotlin
dart
shell
css
vue
svelte
```

### Dimension: language_family

Source: derived from assigned `language` categories.

Rules:

- At least one family per repository; repositories with multiple significant
  language categories may have multiple families.
- Use a lookup table, not keyword matching.
- This dimension gives users broader browsing paths when a raw language list is
  too fragmented.

Initial families:

```text
js-ts
python
web-markup
systems
jvm
dotnet
mobile
shell
data-query
other
unknown
```

Example mapping:

```text
javascript -> js-ts
typescript -> js-ts
html -> web-markup
css -> web-markup
go -> systems
rust -> systems
java -> jvm
kotlin -> jvm
csharp -> dotnet
swift -> mobile
dart -> mobile
shell -> shell
```

### Dimension: domain

Source: topics first, then repository name and description keywords.

Rules:

- A repository may have multiple domains.
- Topic, language, and keyword rules are evaluated as a flat OR in code; the
  first implementation does not assign confidence or ordering between topic and
  keyword matches.
- If no rule matches, omit the dimension rather than assigning a weak category.

Initial domains:

```text
ai-ml
web-frontend
web-backend
devtools
infra-cloud
data-db
security
mobile
game-dev
blockchain
design
docs-content
hardware-iot
education
automation
```

### Dimension: project_type

Source: topics first, then repository name and description keywords.

Rules:

- A repository may have multiple project types.
- Prefer concrete software shape over broad domain.

Initial project types:

```text
framework
library
cli
app
platform
runtime
database
sdk
template
learning-resource
tool
plugin
extension
```

### Dimension: ecosystem

Source: topics, language, name, description, and known framework keywords.

Rules:

- A repository may have multiple ecosystems.
- Ecosystem is more specific than domain and more contextual than language.

Initial ecosystems:

```text
node
python
rust
go
browser
react
vue
svelte
nextjs
deno-bun
jupyter
docker-kubernetes
terraform
android
ios
```

### Dimension: owner_kind

Source: existing owner type metadata.

Rules:

- Exactly one owner kind per repository when owner metadata exists.

Initial owner kinds:

```text
user
organization
unknown
```

### Dimension: maturity

Source: existing repository metadata and star milestone metadata.

Rules:

- Repositories may belong to multiple maturity categories.
- Star-tier categories are based on current stars.
- Lifecycle categories are based on archive status and recent activity data when
  available.

Initial maturity categories:

```text
star-10k
star-50k
star-100k
newcomer-10k
active
archived
```

## Source Fields

The first implementation should use fields already available in the pipeline:

- Repository ID.
- Full name, owner, and repo name.
- GitHub primary language and language breakdown.
- GitHub topics.
- Description.
- Owner type.
- Archived status.
- Current stars.
- Star milestone timestamps.
- Existing weekly, monthly, and yearly ranking inputs.

README contents, commit history, release metadata, package manifests, and issue
metadata are out of scope for the first category release.

## Rule Precedence

Classification should be deterministic and easy to test.

Recommended precedence:

1. Normalize direct source fields.
2. Assign `language` from GitHub primary language plus significant secondary
   languages from the language breakdown.
3. Assign `language_family` from every assigned language's lookup table.
4. Assign `owner_kind` from owner metadata.
5. Assign `maturity` from star, archive, and activity metadata.
6. Assign `domain`, `project_type`, and `ecosystem` by evaluating each
   category's topic / language / keyword predicates as a flat OR over repo name,
   description, topics, and language fields.

Topic and keyword rules should live in one explicit rules module. Avoid spreading
classification logic across pages, route handlers, and build scripts.

Proposed module:

```text
web/lib/categories/rules.ts
```

## Data Artifacts

The category system should be generated as build-time or pipeline-time artifacts.
Paths below are logical view paths inside the published `views/<run_id>/` prefix
unless a section says otherwise.

### Category Registry

Suggested view path:

```text
categories/registry.json
```

Purpose:

- Defines every public category.
- Stores labels, descriptions, aliases, dimension, display order, and SEO state.
- Stores `rules_version` and `generated_at`.
- Controls which categories are allowed to get public routes and sitemap entries.

> **Curated categories bypass `minimum_repo_count`.** A category becomes public when
> `public !== false && count > 0 && (curated || count >= minimum_repo_count)`
> (`web/lib/workflows/recompute/categories.ts`). Because every priority launch language is marked
> `curated` (`web/lib/categories/rules.ts`), all priority languages are public regardless of their
> repo count, while non-curated categories must clear `minimum_repo_count`.

Suggested shape:

```json
{
  "rules_version": "2026-06-07.2",
  "generated_at": "2026-06-04T00:00:00.000Z",
  "dimensions": [
    {
      "id": "language",
      "label": "Language",
      "categories": [
        {
          "id": "language/python",
          "slug": "python",
          "label": "Python",
          "aliases": ["py"],
          "public": true,
          "sitemap": true,
          "minimum_repo_count": 20
        }
      ]
    }
  ]
}
```

### Category Assignments

Suggested view path:

```text
categories/assignments.json
```

Purpose:

- Records category IDs assigned to each repository.
- Allows category rank generation to validate that every ranked repository
  belongs to the requested category.

Suggested shape:

```json
{
  "rules_version": "2026-06-07.2",
  "generated_at": "2026-06-04T00:00:00.000Z",
  "repositories": {
    "123456": {
      "language": ["language/python"],
      "language_family": ["language_family/python"],
      "domain": ["domain/ai-ml"],
      "project_type": ["project_type/library"],
      "ecosystem": ["ecosystem/python"],
      "owner_kind": ["owner_kind/organization"],
      "maturity": ["maturity/star-10k", "maturity/active"]
    }
  }
}
```

### Category Rank Views

Suggested view path pattern:

```text
rank/category/<dimension>/<slug>/all-time/repo/stock.json
rank/category/<dimension>/<slug>/<window>/<period>/repo/<metric>.json
```

Examples:

```text
rank/category/language/python/month/2026-05/repo/flow.json
rank/category/language/rust/week/2026-W22/repo/stock.json
rank/category/domain/ai-ml/year/2026/repo/flow.json
rank/category/language/python/all-time/repo/stock.json
```

Rules:

- Use a dedicated `rank/category/**` subtree so existing global
  `rank/{window}/{period}/{repo|org}/{metric}.json` paths and loaders do not
  need to be overloaded.
- Reuse the same rank metric names as global ranking views.
- Every repository in a category rank file must have the matching category
  assignment.
- Empty or very small category views should not be public unless curated.
- Phase 1 emits only `all-time/repo/stock` category ranks to keep the Workflow
  write budget bounded. Windowed category ranks are added later for the selected
  page rollout set.

### Client Lookup

Suggested view path:

```text
lookup/categories.json
```

Purpose:

- Small client-friendly category metadata.
- Used by navigation, search chips, and category index pages.
- Carries `sitemap` eligibility for each public category so route discovery can
  exclude explicitly hidden category pages without reading the full registry.

Suggested shape:

```json
{
  "rules_version": "2026-06-07.2",
  "generated_at": "2026-06-04T00:00:00.000Z",
  "dimensions": [
    {
      "id": "language",
      "label": "Language",
      "categories": [
        { "id": "language/python", "slug": "python", "label": "Python", "count": 120, "sitemap": true }
      ]
    }
  ]
}
```

## Routes

Recommended public routes:

```text
/categories
/categories/[dimension]
/categories/[dimension]/[slug]
/categories/[dimension]/[slug]/page/[page]
```

Optional language shortcuts (`/languages`, `/languages/[slug]`) were **considered and not
adopted** (see Open Questions). Language pages live only under the canonical
`/categories/language/[slug]` family; no `/languages*` routes exist.

## Page Requirements

Category detail pages should show:

- Category label and short description.
- Repository count.
- Paginated all-time repositories, sorted by current stars. Page 1 remains the
  canonical `/categories/[dimension]/[slug]` URL; page 2+ use
  `/categories/[dimension]/[slug]/page/[page]`.
- Current week or month movers.
- Newcomers when available.
- Related categories.
- Links back to the dimension index and `/categories`.

Category pages should not require visible instructions explaining how the feature
works. The page structure should make scanning and drilling down obvious.

## SEO

Category routes are indexable only when:

- The category is marked `public`.
- The category has enough repositories or is explicitly curated.
- The category has a stable canonical URL.
- The category page is backed by generated data.

Sitemap rules:

- Include `/categories`.
- Include public dimension pages.
- Include public category detail pages.
- Include public category detail pagination pages when the category count
  exceeds the page size.
- Exclude empty categories.
- Exclude categories below `minimum_repo_count` unless explicitly curated.
- Exclude any public category whose lookup entry has `sitemap: false`.
- Use the category data `generated_at` timestamp when available.

## Implementation Phases

> **Status:** Phases 0–4 are **SHIPPED** and proven live (category registry = 214 categories,
> 87 public, 5,302 repo assignments in production). Publish validation enforces the Phase 1
> invariants on every run (see `web/lib/workflows/steps/validate.ts`). **Phase 5 (analytical
> category layer) is the only pending phase**, blocked on the roadmap's analytical data-layer
> decision.

### Phase 0: Documentation and Taxonomy — SHIPPED

Deliverables:

- This document.
- Initial category dimensions and launch category list.
- Agreement that the first release is deterministic and static-read.

Acceptance criteria:

- Roadmap distinguishes scoped category pages from the blocked analytical data
  layer.
- The docs index points to this document.

### Phase 1: Rules and Generated Artifacts — SHIPPED

Deliverables:

- Category registry schema.
- Category assignment generator.
- Deterministic rule module.
- Validation script for counts and assignment invariants.
- Public category lookup.
- All-time category stock rank for public categories.

Acceptance criteria:

- Every repository has at least one `language` and one `language_family`.
- Every repository has exactly one `owner_kind` when owner metadata exists.
- Category IDs are stable ASCII strings.
- Category counts are reproducible from assignments.
- Empty generated public categories fail validation.
- Category all-time rank items are a subset of assigned repositories.

### Phase 2: Language Pages — SHIPPED

Deliverables:

- `/categories` category index.
- `/categories/language` dimension index.
- `/categories/language/[slug]` pages for the priority launch language set.
- Generic `/categories/[dimension]` and `/categories/[dimension]/[slug]`
  route handlers, with non-language categories hidden until the registry marks
  them public.
- Top navigation entry for category browsing.
- Category sitemap entries for public language categories.
- All-time category stock ranks rendered from Phase 1 artifacts. Windowed
  category ranks remain a future expansion.

Acceptance criteria:

- Python, HTML, JavaScript, Go, and Rust pages exist when data is available.
- Ranked repositories on each language page are assigned to that language in
  the generated category assignments.
- Canonical URLs are stable.
- Build, sitemap, and i18n checks cover language page discovery.

### Phase 3: Broader Category Pages — SHIPPED

Deliverables:

- `language_family`, `domain`, `project_type`, `ecosystem`, `owner_kind`, and
  `maturity` dimension and detail pages through the generic category routes.
- Category index page groups public categories by dimension in a scan-friendly
  order.
- Detail-page static params include priority languages plus public categories
  from the published registry.
- Sitemap enumeration honors lookup `sitemap` flags.

Acceptance criteria:

- Public category pages meet the same rank-subset validation as language pages.
- Low-volume categories are hidden from sitemap unless curated.
- Related category links use registry metadata, not ad hoc page code.

### Phase 4: Search and Navigation Integration — SHIPPED

Deliverables:

- Category chips in search or list views.
- Navigation entry for category browsing.
- Optional language shortcut routes if they are worth the URL surface.

Acceptance criteria:

- Client-side category filters use precomputed lookup data.
- Category chips link to canonical category pages.
- Search remains usable without arbitrary server-side filtering.

### Phase 5: Analytical Category Layer — PENDING (only open phase)

Deliverables:

- Arbitrary category combinations.
- Larger repository universe.
- Database-backed exploration.
- Deeper cohort analysis.

Acceptance criteria:

- This phase is blocked until the roadmap's analytical data layer decision is
  resolved.

## Tests

Recommended test coverage:

- Unit tests for slug normalization.
- Unit tests for language-family mapping.
- Unit tests for topic and keyword rules.
- Contract tests for registry schema.
- Contract tests for assignment schema.
- Validation that category rank files only contain assigned repositories.
- Sitemap tests for public category pages and low-volume exclusions.
- SEO tests for canonical URL behavior.

## Open Questions

- ~~Should `/languages/[slug]` exist as a user-facing shortcut, or should language
  pages live only under `/categories/language/[slug]`?~~ **RESOLVED: it does NOT exist.**
  Language pages live only under `/categories/language/[slug]`; there is no `/languages` or
  `/languages/[slug]` route. The single canonical language URL family is `/categories/language/*`.
- ~~What minimum repository count should be required for automatic public category
  pages?~~ **RESOLVED:** the default `minimum_repo_count` is 20. No current
  category definition overrides it; curated categories can still bypass the
  threshold.
- Which categories should be manually curated even if they are below the minimum
  count?
- Should `html`, `css`, `vue`, and `svelte` be treated as languages only, or
  also receive stronger frontend ecosystem treatment by default?
