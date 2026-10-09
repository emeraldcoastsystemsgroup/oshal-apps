# Travel (travel) — OSHAL app package

1.2.4 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

The AI travel concierge (ADR-059). Search real flights via Duffel with YOUR pasted
access token (the per-user broker), get an honest "good price / typical / high" read
from the swarm's shared price history, watch a route for a fare drop, and book via a
deep-link handoff — OSHAL never books or takes payment. Hotels and cars are demo +
deep-link handoffs today. The **travel-concierge** bot reasons over real candidates
and the price read; it never invents a flight or a price.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (ticketType `travel` + the concierge
  workflow + the seven route-backed tools), the `/api/travel` routes
  (flights/hotels/cars + watches + profile + concierge chat), the surface
  (`tools/travel-app.html`, served from the package), and package copies of the
  travel-concierge + travel-foundation personas for the registrar.
- **Stays in the OSHAL kernel:** the swarm-shared **price engine + fare-watch cron**
  (`@/app/routes/travel-farewatch`: `ensureTravelSchema` / `routeKeyFor` /
  `recordObservations` / `priceRead` + `startTravelFareWatchCron` —
  `travel_observations` is the swarm-wide price DB other bots read; the packaged
  route imports the engine back via the `@/` alias), `scripts/oshal-duffel.js` +
  the `duffel` connector + token broker, migrations `050-travel-platform.sql` +
  `051-seed-travel-bots.sql` (framework-owned, boot bootstrap), and the
  travel-concierge node (container + both `swarm-bot-registry` blocks).

## Surfaces

| Tile | URL | What |
|---|---|---|
| Travel | `/api/travel/app` | Concierge surface — search, price read, watches, chat (self-served by this package) |

## Install

```bash
node scripts/oshal-app.js install travel
```

No package migrations — the shared `travel_*` schema is framework-owned (the store
outlives the surface: the kernel fare-watch cron keeps re-pricing watches and growing
the price DB whether or not this package is installed). Guest tier request is `full`
(the core Tier-A demo posture); until an operator approves it, guests get the D4
read-only default.

Travel 1.2.2 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/travel-app.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| travel-concierge-chat | concierge chat turn | T2 | none | disable | not yet measured | none recorded |
| travel-ticket | travel request ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
