# brand-graphics — an OSHAL app package

1.1.2 adds the family audience view (ADR-164 D6): the Home shell (Jarvis) opens this package's first surface, `GET /api/brand-graphics/review`, with `?audience=family`; the shared kit paints a card from the package's own home-summary (read-only, owner-scoped) with the cockpit escape and an in-frame link to the full page, refusals said and never filled in; without the audience the page runs unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`.

On-brand OSHAL motion graphics: a specialist bot turns a short brief ("intro for
daily trade recap") into the validated electric-"oshal" intro look by driving
Google Vids (Veo + Voiceover + Music) on the operator's signed-in remote Chrome,
and returns the project URL.

Carved out of the OSHAL core repo 2026-07-17 (ADR-085 Wave 1 — the first Wave-1
carve, and the first packaged **CLI tool**: `brand_graphic`'s script ships in
`tools/` and is invoked via the manifest's `{packageDir}` token).

## Contents

| Piece | File |
|---|---|
| Manifest | `oshal-app.yaml` |
| Bot persona | `personas/brand-graphics.yaml` (agentId `b0110000-…-000000000001`) |
| CLI tool | `tools/oshal-brand.js` — enqueues a `kind: 'brand'` job to `/api/vids/jobs` |
| Review page | `routes/review.js` serves `tools/review.html` at `GET /api/brand-graphics/review` (the cockpit tile) |
| Home summary | `routes/home-summary.js` at `/api/brand-graphics/home-summary` |
| Readiness smoke | `routes/package-smoke.js` at `/api/brand-graphics/_smoke` (service auth) |

No migrations, no schedules, no theme CSS. The cockpit tile opens this package's own review page.

## Dependencies

- **vids** (`dependencies.apps: [vids]`) — the `/api/vids` API + the
  `@oshal/vids-operator` worker do the actual rendering. vids is framework-resident
  today; the resolver satisfies the dependency from core until vids itself carves.

## Install

```bash
node scripts/oshal-app.js install brand-graphics
```

Ships `status: inactive` (parity with how it lived in core). Toggle it active once
a Vids worker is registered and signed in: the operator's
`PATCH /api/swarm/apps/brand-graphics/toggle` with `{"active": true}`, a choice that survives
reloads and restarts. The brand look + Veo filter-safe rules
are documented with the vids-operator package (`BRAND-THEME.md` in the framework).

The package has no authorization catalog, so a person needs `@app-admin` on `brand-graphics`
(granted on `/access`). Without it the tile is locked, the review page answers 403, and a turn
with the brand specialist is refused with `authorization_app_admin_required`.

Since Create 1.9.6, Brand Graphics is also one of Create's studios: the Studios rail, a Home card,
the **Brand intro clip** quick start and **Create → Video**. Each opens this package's review page.
On the operator's box (2026-10-06) the package was turned on, and the brand specialist answered
the operator's chat on the fleet default (`antigravity-cli`).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| brand-graphic | brand motion graphic | T2 | hosted | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
