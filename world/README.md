# World Intelligence — OSHAL app package

## Home briefing and connected action (1.1.1)

The session-only `GET /api/world/home-summary` reads the existing shared archive. It samples the latest 100 saved items per baseline World topic, chooses articles published within 48 hours, and shows up to three distinct source articles from different topics, plus the earliest recorded event in the coming seven days. Old, future and unknown publication dates do not become current headlines merely because a feed reimported them. This bounded sample is not a global importance ranking or personalized briefing. Publication dates and subject labels accompany the saved evidence.

Four selectable metrics use the preceding 24 hours of `world_pulls`: fetched items (including repeat pulls), newly recorded subject items (one article may occur under multiple subjects), distinct subjects pulled, and feed-pull records. These are not unique-event or unread counts. Missing sources remain unavailable. The reader never creates schemas, ingests, classifies or calls a model/provider.

Fresh AI, technology, healthcare and energy items with product, research or commercial-development titles can offer **Explore as a venture** when a compatible Venture Plan receiver is loaded. A conservative title filter excludes sports, court and violent-event stories; it is a navigation aid, not an opportunity assessment. Other headlines retain their evidence link without a Venture suggestion. The action passes the title, supporting evidence and public source URL into a reviewable draft. The user chooses Scope it to create/research anything. Venture Plan is an optional integration partner, not an installation dependency. This version requires core's versioned integration contract and bounded subject-selectable `coverageSnapshot` reader.

`?app=world` — the swarm's SHARED world-intelligence layer (ADR-061, Layer B).
Multi-source news feeds (Google/Bing News, Reddit, ...) are fetched, classified, and
bias-rated into a shared ArangoDB graph + TimescaleDB series + classified archive. Ask
the analyst "what's the press saying about X" and get a structured, bias-contextualized
read — the political axis, the economic axis, outlet kinds, consensus, per-outlet values —
not the misleading naive average.

Carved out of OSHAL core 2026-07-20 (ADR-085 Wave 3, "skill with a surface").

## What this package is

- `routes/world-routes.js` (built from `src-routes/world-routes.ts`) — mounted at
  `/api/world` (auth: public — EXACTLY the kernel's mount posture, ADR-085 D2):
  - **Writes are fail-closed** on `WORLD_INGEST_TOKEN` (`POST /contribute`,
    `/seed-outlets`, `/ingest-news`, `/backtest`) — with no token configured every
    write is rejected. Machine feeders authenticate through `Authorization: Bearer`
    (or `X-World-Ingest-Token` for constrained internal clients). URL `?token=`
    credentials are always rejected so access logs, referrers, and copied URLs cannot retain
    the secret.
  - **Reads are open by design** (`GET /metric`, `/sentiment`, `/pulls`, `/neighbors`,
    `/entities`) — a shared world feed with no per-user data.
  - `GET /app` — the cockpit World Intelligence dashboard (the kernel slice's
    `WORLD_APP_HTML`, imported via `@/features/world-data`).
  - The whole surface 503s unless `ENABLE_WORLD_INTELLIGENCE` (+ graph/series
    backends) is configured.
- `oshal-app.yaml` — the world-analyst bot + foundation (package persona COPIES for
  the registrar), the seven `world_*` cli tools (over the kernel-resident
  `scripts/oshal-world.js`), the `world-refresh` (6-hourly depth) + `ticker-pulse`
  (5-min market-hours) framework schedules, the world-dashboard ribbon surface, and
  the `world` ticket workflow.

## What stays framework-resident (ADR-093)

The Layer-B ENGINE (`src/features/world-data` — World-Intelligence Service,
contribution schemas, outlet bias/reliability ratings, news fetcher/classifier/
backtester, feed registries, and the `WORLD_APP_HTML` surface module) — it keeps real
kernel importers (the jarvis morning brief, the trading assess/research/schedule
dispatchers, the strategy-lab sim) and is imported back via preserved `@/` aliases.
Also kernel-resident: `world-schedule-dispatch` (the deterministic refresh/pulse
dispatcher the schedules fire through), `scripts/oshal-world.js`, the world-analyst
registry entry + ai-lab personas, the `WORLD_INGEST_TOKEN` compose env, the
`tool-world-dashboard` default cockpit tile, and weather-bot (shared with trading).

## Status

Needs `ENABLE_WORLD_INTELLIGENCE=true` + `ARANGO_URL` (graph) + `TSDB_URL` (series)
on the framework, and `WORLD_INGEST_TOKEN` for machine writes. The refresh/pulse
schedules execute only when `ENABLE_AGENT_SCHEDULER=true`.

## Test Lab catalog (1.2.1)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/surface-parse.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/auth-header.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/home-summary.test.cjs` | unit | Isolated Node runner; synthetic data only |

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.
