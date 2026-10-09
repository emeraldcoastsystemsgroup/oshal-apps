# Creative Studio (creative-studio) — OSHAL app package

1.2.3 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

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

## Family audience view (1.2.2)

The Home shell opens the review page as `/api/creative-studio/review?audience=family`
(ADR-164 D6). The shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme
bootstrap) paints the signed-in account's own story videos in plain words: how many are waiting
or being made (one count: the route counts queued and running stories together, so the view
never calls a queued story "being made"), finished in the last five days and not finished (all
time), when the newest one last changed, a title that names the account's state, and the newest
three stories as tiles with where each one stands ("Waiting its turn", "Being made now", "Finished", "Did not finish").
On open it makes exactly one read, `GET /home-summary`, under the caller's session: no
connected-actions plan, no handoff listener, no write, and it never starts or produces a story.
The one action and the escape open Creative Studio in the cockpit. Signed out, refused, a count
the route could not check, every source failed and an unreachable server are each named. Any
other request runs the full page unchanged; its module script is gated on the kit's decision,
so nothing but the view's own read runs behind a view.

```bash
node --test creative-studio/tests/audience-view.test.cjs
OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs creative-studio
```

The first runs from the store root with no browser: the static kit contract and the view's
behaviour over the package's real home-summary route (only `express` stubbed, a stub pool). The
second drives `tests/audience-view.fixture.cjs` over the real page and the real kit in headless
Chromium. The first is registered as the `audience-view` case of the Lab catalog.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| story-video | story video | T2 | hosted | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
