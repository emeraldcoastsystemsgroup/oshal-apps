# Creative Studio (creative-studio) — OSHAL app package

The creative bot that just cycles: it produces short, kid-safe videos from a
rotating public-domain library (Aesop fables, classic fairytales, famous
sayings/idioms), animating each ~100-word story across ~10 continuous Google Vids
scenes via the EXTEND button (ADR-080), downloading the finished MP4, and saving
it to the content folder + the operator's Google Drive. The **vids-operator** bot
owns the content library + production; a `creative-story` ticket (manual or
scheduled — `workflow:creative-story` cron) dispatches `content.next` /
`content.produce` to the registered remote Vids worker.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface" —
this app never had a route of its own):

- **In this package:** the app manifest (ticketType `creative-story` + the graph
  workflow), the three `creative_*` CLI tools, the Creative Studio ribbon tile
  (a view over the Vids job queue at `/api/vids/app`), and a package copy of the
  vids-operator persona for the registrar.
- **Stays in the OSHAL kernel:** the SHARED **vids-operator remote-client desktop
  worker** (`packages/oshal-vids-operator` → `npx oshal-vids worker`) with its
  registry entries in BOTH `swarm-bot-registry` blocks (all four vids-family apps
  reference it), `scripts/oshal-vids.js` (the CLI the `creative_*` tools shell
  to), and the ADR-080 Extend-story content library + production engine (it lives
  in the desktop worker package's `content.*` tools).
- **Owned by the `vids` app (declared dependency):** the `/api/vids` dispatch
  surface + the `vids_jobs` ledger (migration 059) this app's tile reads.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Creative Studio | `/api/vids/app` | The Vids job queue (story jobs land in `vids_jobs` too) — served by the `vids` app |

## Install

```bash
node scripts/oshal-app.js install creative-studio
```

No routes and no migrations of its own. Requires the `vids` app (resolved
npm-style at install) and a running Vids worker on a machine with a screen:

```bash
npx @oshal/vids-operator chrome   # debug Chrome on a dedicated profile
npx oshal-vids worker             # register with the swarm + poll for jobs
```

## Cycle it

Create a Redis-backed schedule whose `taskType` is `workflow:creative-story`
(e.g. cron `0 */6 * * *`) — every fire creates an auto-started `creative-story`
ticket that produces the next unproduced story in the rotation.
