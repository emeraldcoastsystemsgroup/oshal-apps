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
