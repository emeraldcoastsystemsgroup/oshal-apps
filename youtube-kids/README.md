# youtube-kids ("Kid Lens") — an OSHAL app package

Upload your Google Takeout YouTube watch history and get a parent-friendly brief on what
your kid is into — top interests, what the unfamiliar channels actually are, gift ideas,
and ready-to-use conversation openers. Read-only; nothing is posted or sent anywhere.

Carved out of OSHAL core 2026-07-17 (ADR-085 Wave 1 carve #2). This package is the app's
only home.

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | Manifest: the inline Kid Lens bot, one route, ribbon tile, `sakura` theme, `suite: ai-home`. |
| `src-routes/` | TypeScript sources (developer source of truth): the router + the Takeout watch-history parser. |
| `routes/` | **Compiled JS** the loader mounts (`oshal-app build` output). |
| `personas/kid-lens-analyzer.yaml` | The analyzer bot's persona. |
| `tools/youtube-kids-dashboard.html` | The upload + brief surface, served by the route from this package dir. |

## Install

```bash
node scripts/oshal-app.js install youtube-kids     # from an OSHAL checkout
```

The app ships `status: inactive` (parity with how it lived in core after its 2026-07-16
retirement from the default catalog). Activate via
`PATCH /api/swarm/apps/youtube-kids/toggle` with body `{"active": true}` or the cockpit
applications page. On activation the loader registers the `kid-lens-bot` inline concierge
from the manifest and mounts `/api/youtube-kids` (OIDC-gated).

## How it works (ADR-036 split)

- **Ingest** (cheap, deterministic, in the route): parse `watch-history.json` into a compact
  aggregate; store it `user_sub`-keyed in `oshal_youtube_activity` with the raw export
  AES-256-GCM-encrypted at rest. The table is created **lazily at first use** with
  owner-scoped RLS applied at the same chokepoint — no install-time migrations.
- **Reasoning** (the brief): always runs on the accountable Kid Lens bot
  (`executeBotOrInline` → cost in `chat_tasks` under the bot's own agent id).

## Rebuilding `routes/*.js` after editing `src-routes/`

From an OSHAL checkout:

```bash
node scripts/oshal-app.js build <this dir> --framework .
```

## Known integration gaps

- **Generic Takeout-archive spine:** pre-carve, uploading a *whole* Takeout zip to the
  core storage spine (`/api/takeout`) also routed the watch-history slice here. The carve
  removed that youtube slice from the core spine (no app literals in the kernel), and
  package-contributed slice registration is framework roadmap. Until then, use the app's
  own surface, which accepts `watch-history.json` directly — the ingest result is
  identical.
- v1 is Takeout-upload only. The live `youtube.readonly` API (subscriptions/likes) needs
  Google app verification for the sensitive scope first.
