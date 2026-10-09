# World Intelligence — OSHAL app package

## Sources and schedules (1.4.0)

Operators get a **Sources & schedules** page (link in the dashboard header, served at `/api/world/operations/app`). Everyone else never sees the link: the page and its routes are mounted `auth: operator`.

- **Schedules.** The two World jobs, `world-refresh` (6-hourly depth refresh) and `ticker-pulse` (every 5 minutes, 08–23 server time, weekdays), with their cron, next and last run and run count. Each can be switched off and on, moved to a preset cadence or a custom cron, and reset to the manifest. A cadence with less than `APP_SCHEDULE_MIN_INTERVAL_MINUTES` (default 5) between fires is refused. The change applies at once and survives restarts, reloads and app toggles. These controls are core's operator routes (`GET /api/swarm/apps/world/schedules`, `PATCH /api/swarm/apps/world/schedules/:id`), so the page reads and writes them directly.
- **Where World pulls from.** Every per-subject feed (Google News, Bing News, Yahoo Finance, Reddit, Hacker News and the on-demand-only feeds), the publisher firehose (the whole pass and each of its feeds) and the five depth collectors (Nasdaq earnings calendar, congressional trades, openinsider, FINRA short volume, USAspending). Each row shows where it pulls from, which schedule uses it, the `.env` flags that also govern it, and its last-24-hour pulls or, for a collector, when it last ran and how that run ended.
- **Switches.** A switch only turns a source off; the `.env` flags stay the ceiling. Each row names the flags that govern it, and its status reads "switched off", "off in .env" with the flag, both, or "pulling". Feeds and the firehose follow a change within `WORLD_SOURCE_SWITCH_TTL_MS` (default 30 s); collectors at the next depth refresh. A switched-off feed is skipped for every caller, including an explicit `world_ingest` request, and is reported as skipped.

Routes this package adds, all operator-only: `GET /api/world/operations/ping`, `GET /app`, `GET /sources`, `PATCH /sources/:id` with `{ "enabled": true | false }`. The switch store, the collector run record and the source inventory are core's (`world-data` skill), so 1.4.0 needs a core that carries them (core PR #1026). On an older core `/ping` answers 503 and the dashboard keeps the link hidden.

## Observed outlet ratings (1.3.0)

Every outlet rating this package shows is oshal's own, computed by core from the sentiment oshal itself stored (core ADR-061, update 2026-10-01). There is no hand-typed seed table and no licensed dataset. For each source, on every subject and day that another source also scored, core compares the source's mean sentiment with the mean of the other sources'. A source's **lean** is its average divergence (above 0 reads more favourably than the others, below 0 more critically; it is not a political left or right), and its **reliability** is how closely it tracks them (1 minus half the average absolute divergence). The dashboard's by-source table shows each rating with the compared subject-days, subjects and date range behind it; a source below the stated minimums (by default 20 compared subject-days and 3 subjects over the last 90 days) shows **insufficient data**, never a number. The lean axis groups sources that usually read below, near or above the others, and the note under it states the method with its own numbers. A server whose core does not report ratings gets a plain notice instead of numbers. Proven by `tests/surface-ratings.test.js` (Test Lab case `surface-ratings`); core's Test Lab card `world-outlet-ratings` reads the live ratings after a deploy.

1.2.5 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

## Home briefing and connected action (1.1.1)

The session-only `GET /api/world/home-summary` reads the existing shared archive. It samples the latest 100 saved items per baseline World topic, chooses articles published within 48 hours, and shows up to three distinct source articles from different topics, plus the earliest recorded event in the coming seven days. Old, future and unknown publication dates do not become current headlines merely because a feed reimported them. This bounded sample is not a global importance ranking or personalized briefing. Publication dates and subject labels accompany the saved evidence.

Four selectable metrics use the preceding 24 hours of `world_pulls`: fetched items (including repeat pulls), newly recorded subject items (one article may occur under multiple subjects), distinct subjects pulled, and feed-pull records. These are not unique-event or unread counts. Missing sources remain unavailable. The reader never creates schemas, ingests, classifies or calls a model/provider.

Fresh AI, technology, healthcare and energy items with product, research or commercial-development titles can offer **Explore as a venture** when a compatible Venture Plan receiver is loaded. A conservative title filter excludes sports, court and violent-event stories; it is a navigation aid, not an opportunity assessment. Other headlines retain their evidence link without a Venture suggestion. The action passes the title, supporting evidence and public source URL into a reviewable draft. The user chooses Scope it to create/research anything. Venture Plan is an optional integration partner, not an installation dependency. This version requires core's versioned integration contract and bounded subject-selectable `coverageSnapshot` reader.

`?app=world` — the swarm's SHARED world-intelligence layer (ADR-061, Layer B).
Multi-source news feeds (Google/Bing News, Reddit, ...) are fetched, classified, and
stored in a shared ArangoDB graph + TimescaleDB series + classified archive, and every
source is rated from that stored coverage. Ask the analyst "what's the press saying about
X" and get a structured, bias-contextualized read — the lean axis, consensus, the
reliability-weighted read, per-source values with their observed ratings — not the
misleading naive average.

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
  - `GET /app` — the cockpit World Intelligence dashboard, with its HTML bundled
    in this package as `src-routes/world-app-html.ts`.
  - The whole surface 503s unless `ENABLE_WORLD_INTELLIGENCE` (+ graph/series
    backends) is configured.
- `routes/world-operations.js` (built from `src-routes/world-operations.ts`, page in
  `src-routes/world-ops-html.ts`) — mounted at `/api/world/operations` (auth: operator):
  the Sources & schedules page and its source switches (1.4.0, above).
- `oshal-app.yaml` — the world-analyst bot + foundation (package persona COPIES for
  the registrar), the seven `world_*` cli tools (over the kernel-resident
  `scripts/oshal-world.js`), the `world-refresh` (6-hourly depth) + `ticker-pulse`
  (5-min market-hours) framework schedules, the world-dashboard ribbon surface, and
  the `world` ticket workflow.

## What stays framework-resident (ADR-093)

The Layer-B ENGINE (`src/features/world-data` — World-Intelligence Service,
contribution schemas, outlet identity and the observed outlet ratings, news
fetcher/classifier/backtester, and feed registries) keeps core importers in Jarvis, Trading and the
world scheduler. The package imports the engine via preserved `@/` aliases and
declares `uses: world-data`. Core's kernel-skill contract pins the barrel plus
the four deep modules this package imports; an older core refuses package version
1.2.3 at manifest load instead of failing later at route mount. The dashboard
HTML travels with the package surface, not the engine.
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
| `tests/surface-ratings.test.js` | unit | Isolated Node runner; the dashboard script runs in a vm context over synthetic sentiment answers |
| `tests/world-operations.test.cjs` | unit | Isolated Node runner; the compiled operations route with the kernel modules stubbed |
| `tests/ops-surface.test.js` | unit | Isolated Node runner; the Sources & schedules page script runs in a vm context over synthetic schedule and source answers |

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| news-classification | news item | T1 | none | template | not yet measured | none recorded |
| world-ticket | world intelligence ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
