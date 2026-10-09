# Feeds (feeds) — OSHAL app package

1.2.3 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Your connected message feeds in one place. Connect Slack at `/utilities` (the
`communication` connector category); a kernel cron indexes your OWN messages into
`feed_messages`, and this app's surface shows the live stream + activity trends + hot
channels + trending topics. The **feeds-curator** bot reasons over the index ("what
did I miss") and owns the Feeds queue (ticketType `feeds`). Reads are cheap (DB); the
brain runs on the curator via the orchestrator.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (ticketType `feeds` + the Feeds Curation
  workflow), the `/api/feeds` routes (dashboard, status, messages, settings GET/PUT,
  manual sync — a VIEW over the shared index), the dashboard (`tools/feeds.html`), and
  a package copy of the feeds-curator persona for the registrar.
- **Stays in the OSHAL kernel:** the feeds-indexing **engine + cron**
  (`startFeedsIndexingCron` / `ensureFeedsSchema` / `indexUserFeed` — the ingest that
  fills `feed_messages`), `scripts/oshal-feeds.js` (the `slack_feed` tool's CLI) and
  `045-feeds-platform.sql` (the schema + curator seed), the feeds-curator **inline
  node** (`container: oshal-api`, both `swarm-bot-registry` blocks), the `slack`
  connector, and the `/feeds` framework page (`src/pages/feeds/index.html` via
  `server-ui-assets`) with its default toolbar tile in `oshal-framework.json`.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Feeds | `/api/feeds/dashboard` | Live stream + trends + hot channels (self-served by this package) |

The framework also serves the same dashboard at `/feeds` for the default toolbar tile
(kernel-resident); this package's tile self-serves it so the app is standalone.

## Install

```bash
node scripts/oshal-app.js install feeds
```

No migrations — the `feed_messages` schema + curator seed are created by the
kernel-resident engine (`045-feeds-platform.sql` + `feeds-indexing.ensureFeedsSchema`),
which stays framework-resident with the indexing cron. This surface only reads them.

## Configurable Home summary (1.1.0)

GET /api/feeds/home-summary reads existing caller-owned Slack index rows and saved feed settings. All four data points default on:

| Metric id | Meaning |
|---|---|
| indexed-24h | Indexed Slack messages posted in the preceding 24 hours, excluding future timestamps. |
| indexed-5d | Indexed Slack messages posted in the preceding 120 hours. This is a rolling window, not five calendar dates. |
| indexed-channels | Distinct channel ids represented in the caller's saved Slack index, across all indexed dates. |
| sync-age | Age of feed_settings.last_synced_at. No row is "Not recorded"; invalid/future time is "Unknown". |

Counts describe the saved index, not unread messages, configured subscriptions, or a complete provider history. Slack must be connected and synced through Feeds to populate it. No summary GET refreshes a token, polls Slack, invokes an indexing helper, or creates tables. Each failed source remains unavailable beside successful sources; both failing returns 503. Details open feeds-dashboard.

This manifest requires the matching core metricsPointer support (core PR #411). The matching core and this package were deployed and authenticated Home rendering was verified on 2026-09-10 UTC; see APP-HOME-EXTRACTION-PLAN.md for the rollout record. Validation: 12 compiled-route tests in scripts/home-summary.test.cjs; scripts/home-summary.integration.cjs exercises actual PostgreSQL schemas, owner RLS and SELECT-only source grants, plus Chromium desktop/mobile and saved metric hiding. Run the integration harness from the matching core checkout with HOME_TEST_DATABASE_URL pointing to a disposable localhost database named home_summary_test. It uses mock sign-in and seeded records, not live accounts.

Feeds 1.2.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/feeds.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

## Company audience view (1.2.2)

The Business shell opens the dashboard as `/api/feeds/dashboard?audience=company` (ADR-164 D6).
The shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints
"Productivity · Feeds": the 24-hour indexed count as the title, four stats (indexed / 24 h,
indexed / 5 days, channels in the index, last sync with the auto-index setting as its hint),
the newest saved entries (channel, message, when) and the summary's own notes about what the
numbers are. On open it reads only `GET /home-summary` and `GET /settings` under the caller's
session. It never reads `GET /messages` (which indexes synchronously on a first open and starts
a background sync otherwise), never reads `GET /status` (which can refresh the Slack token) and
never calls `POST /sync`; the one action opens Feeds in the cockpit, where syncing and settings
live. No saved index yet, unavailable counts, a partial summary, a failed settings read, 401, 403
and a failed summary read are each named. Any other request runs the full dashboard unchanged;
its start (settings, messages, the live poll) is gated on the kit's decision, so nothing but the
view's own reads runs behind a view, and a core without the kit runs it as before.

## Testing

Registered in `tests/test-lab.yaml`.

- `node --test tests/audience-view.test.cjs` — the audience view contract and behaviour (stub
  kit, stub fetch, stub DOM; no browser). `OSHAL_FRAMEWORK=<core checkout> node
  scripts/audience-views.browser.cjs feeds` from the store root drives
  `tests/audience-view.fixture.cjs` over the real page and the real kit in headless Chromium.
- `node --test scripts/home-summary.test.cjs` from the store root (the store-CI `home-summary`
  job) covers this package's compiled `routes/home-summary.js`.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| feeds-curation-ticket | feeds ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
