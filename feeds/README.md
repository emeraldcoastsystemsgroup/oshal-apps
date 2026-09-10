# Feeds (feeds) — OSHAL app package

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
