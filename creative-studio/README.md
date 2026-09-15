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
  (the review and editable brief at `/api/creative-studio/review`), and a package copy of the
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
| Creative Studio / Create Stories | `/api/creative-studio/review` | Recorded work and an editable next brief, with connected draft actions and a link to Vids Studio |

## Install

```bash
node scripts/oshal-app.js install creative-studio
```

The package owns its review, Home summary and readiness routes; it adds no migrations.
Production requires the `vids` app (resolved npm-style at install) and a running
Vids worker on a machine with a screen:

```bash
npx @oshal/vids-operator chrome   # debug Chrome on a dedicated profile
npx oshal-vids worker             # register with the swarm + poll for jobs
```

## Cycle it

Create a Redis-backed schedule whose `taskType` is `workflow:creative-story`
(e.g. cron `0 */6 * * *`) — every fire creates an auto-started `creative-story`
ticket that produces the next unproduced story in the rotation.

## Stories appearance and verification

Version **1.2.1** makes the existing Stories review page follow the shared portal
palette, including live changes, standalone tabs and Create's optional Application
colors. Its recorded-work controls and unsent brief stay in the same document.
The page's business script, routes and production workflow are unchanged.

Run from the public application checkout with a core checkout containing installed
Express, Playwright and Chromium dependencies. `OSHAL_CORE_ROOT` can name that core
checkout; otherwise the fixture looks for sibling `oshal`. The optional Create
skin check also needs sibling `create/ui/create.css` from this store.

```bash
node --test creative-studio/tests/browser/creative-theme-proof.mjs
```

Seven actual-page Chromium tests cover all twelve palettes, text contrast, retained
drafts, real shared handoff code, cross-tab changes and mobile/laptop layouts.
Only synthetic records and ephemeral local HTTP are used; all external requests
and business mutations are rejected. This is source/browser proof, not installed
provider or production acceptance. The [Lab catalog](tests/test-lab.yaml) registers
the browser suite with its explicit prerequisites and retains the existing safe
readiness smoke. Unavailable browser prerequisites remain pending.
