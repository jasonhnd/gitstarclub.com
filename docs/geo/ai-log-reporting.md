---
owner: geo
status: active
last_reviewed: 2026-07-05
source_of_truth_for:
  - AI crawler log report runbook
  - aggregate referrer taxonomy
---

# AI crawler and referrer log reporting

GitStarClub measures GEO crawler reach and AI referrals from Vercel-side request logs. This path is aggregate-only: it does not add client JavaScript, browser analytics events, cookies, user ids, IP addresses, or stored raw referrer URLs.

## Run the report

Save a Vercel Log Drains JSON array, NDJSON stream, or exported request-log JSON to a local file, then run:

```bash
cd web
bun run geo:report -- --input ../vercel-logs.ndjson --format markdown
```

For machine-readable output, omit `--format markdown`:

```bash
cd web
bun run geo:report -- --input ../vercel-logs.ndjson
```

For weekly buckets, add `--grain week`. Without `--input`, the script reads stdin, so a Vercel-native log export can be piped directly into the command.

## Supported input

The parser accepts the Vercel Log Drains request shape documented for JSON and NDJSON logs:

- `proxy.userAgent`
- `proxy.referer`
- `proxy.path`
- `proxy.statusCode`
- `proxy.timestamp`

It also accepts common exported field names such as `requestUserAgent`, `requestReferrer`, `requestPath`, `userAgent`, `referrer`, `path`, `statusCode`, and `timestamp`.

## Output

The report emits only aggregate rows:

- `crawler_counts`: `date`, `user_agent_family`, `path_family`, `status_bucket`, `count`
- `referrer_counts`: `date`, `referrer_host`, `path_family`, `count`
- `taxonomy`: the crawler, referrer, and path-family definitions used for classification

Raw IPs, request ids, JA3/JA4 fingerprints, cookies, full URLs, and raw query strings are not included in output. Do not commit raw Vercel log exports; if a report snapshot is checked in later, check in only the aggregate output.

## User-agent taxonomy

| Family | Match token |
|---|---|
| `GPTBot` | `GPTBot` |
| `OAI-SearchBot` | `OAI-SearchBot` |
| `ChatGPT-User` | `ChatGPT-User` |
| `PerplexityBot` | `PerplexityBot` |
| `Perplexity-User` | `Perplexity-User` |
| `ClaudeBot` | `ClaudeBot` |
| `Claude-SearchBot` | `Claude-SearchBot` |
| `anthropic-ai` | `anthropic-ai` |
| `Google-Extended` | `Google-Extended` |
| `Applebot-Extended` | `Applebot-Extended` |
| `Applebot` | `Applebot` |
| `Bingbot` | `Bingbot`, `bingbot` |
| `CCBot` | `CCBot` |

## Referrer taxonomy

| Normalized host | Match rule |
|---|---|
| `chatgpt.com` | host or subdomain |
| `chat.openai.com` | exact host |
| `perplexity.ai` | host or subdomain |
| `gemini.google.com` | exact host |
| `google.com` | only when visible referrer markers indicate AI Overview or AI Mode |
| `copilot.microsoft.com` | exact host |
| `claude.ai` | host or subdomain |
| `grok.com` | host or subdomain |
| `x.com` | host or subdomain |

Referrers are normalized to host only. The report never stores or prints a full referrer URL.

## Path families

| Family | Paths |
|---|---|
| `repo` | `/:owner/:name` |
| `org` | `/o/:login` |
| `rankings` | `/rankings`, `/rankings/*` |
| `category` | `/categories`, `/categories/*` |
| `pulse` | `/pulse`, `/pulse/*` |
| `compare` | `/compare`, `/compare/*` |
| `about` | `/about`, `/about/*` |
| `data-export` | `/data/exports/*` |
| `other` | everything else |
