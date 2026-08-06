# youtube-kids ("Kid Lens") — an OSHAL app package

Upload a Google Takeout YouTube watch history and get a parent-friendly brief on what a
child is into: top interests, unfamiliar channels, gift ideas, and conversation openers.
The application is read-only; it does not post or send anything.

Carved out of OSHAL core on 2026-07-17 (ADR-085 Wave 1 carve #2). This package is the
application's only home.

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | Manifest: inline Kid Lens bot, routes/smoke, Takeout slice, ribbon tile, `sakura` theme, and `suite: ai-home`. |
| `src-routes/` | TypeScript source of truth for the router and Takeout parser. |
| `routes/` | Compiled JavaScript mounted by the loader (`oshal-app build` output). |
| `personas/kid-lens-analyzer.yaml` | The analyzer bot's persona. |
| `tools/youtube-kids-dashboard.html` | Upload and brief surface served from this package. |

## Install and activation

```bash
node scripts/oshal-app.js install youtube-kids     # from an OSHAL checkout
```

The package ships with `status: inactive`, preserving its retired-by-default catalog posture.
Activate it with `PATCH /api/swarm/apps/youtube-kids/toggle` and body `{"active": true}`, or
through the cockpit Applications page. Activation registers the `kid-lens-bot`, mounts the
OIDC-gated `/api/youtube-kids` route, and contributes the watch-history slice to the generic
`/api/takeout` archive spine. Toggle-off or uninstall retracts the route and archive handler
without a kernel restart. Installation alone intentionally exposes no handler while inactive.

## How it works (ADR-036 split)

- **Ingest** is cheap and deterministic. It parses `watch-history.json` into a compact
  aggregate, then stores the aggregate by `user_sub` in `oshal_youtube_activity`; the raw
  export is AES-256-GCM encrypted at rest. The table is created lazily at first use with
  owner-scoped RLS applied at the same chokepoint, so there is no install-time migration.
- **Reasoning** always runs on the accountable Kid Lens bot through `executeBotOrInline`.
  Cost lands in `chat_tasks` under the bot's agent id, and the prompt receives the compact
  aggregate rather than the raw viewing log.
- **Whole archives** use the generic kernel scanner. This package declares the current Google
  JSON/HTML path suffixes and exports `ingestTakeoutWatchHistory`; it reuses the exact direct
  upload store path, including encryption, RLS bootstrap, and stale-brief invalidation.

## Rebuilding `routes/*.js`

From an OSHAL checkout:

```bash
node scripts/oshal-app.js build <this dir> --framework .
```

## Product backlog (canonical)

The local package/framework registration contract is complete. Remaining acceptance and product
work belongs here, not as application literals or dispatch cases in the kernel:

- **Real data and Dropbox acceptance:** activate an installed release candidate; ingest a current
  Google Takeout whole archive once through browser upload and once through a caller-owned Dropbox
  connection; retain redacted owner-isolation, counts, and failure evidence. Generated-zip tests
  prove the local contract, not Google's current export or Dropbox behavior.
- **Harvest privacy and lifecycle:** define parental consent, child-data minimization, retention,
  export, and deletion policy for the encrypted raw history. Decide whether raw history should be
  deleted immediately after aggregation. The reasoning prompt must continue receiving only the
  compact aggregate, never the raw viewing log.
- **YouTube API scope:** v1 remains Takeout-only. Add `youtube.readonly` subscriptions/likes only
  after Google sensitive-scope verification, explicit parental consent, revocation, and a recorded
  least-privilege review. Do not imply that scope is currently authorized.
- **Additional lenses:** add another product only through its own manifest-contributed literal
  slice and package handler, with an explicit privacy/retention contract. Do not put product
  regexes, names, or dispatch cases in the kernel.
- **Multiple children:** introduce explicit parent-owned child profiles before combining uploads.
  Partition aggregates, raw-data lifecycle, briefs, exports, and deletion by child; a parent's
  authorization must not let one child's observations silently appear in another child's brief.

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document package-driven whole-archive registration and make remaining privacy/product acceptance canonical here. -->

## `SESSION_SECRET` Takeout recovery

Set a nonblank `SESSION_SECRET` before uploading. A raw Takeout export encrypted under the retired
public fallback cannot be authenticated with a newly provisioned secret; upload the original
`watch-history.json` again. The app recomputes the aggregate and replaces the unreadable raw blob.
