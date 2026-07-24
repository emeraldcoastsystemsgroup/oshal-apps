# World Intelligence — OSHAL app package

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
    write is rejected; machine feeders post with the bearer token.
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
