# Travel (travel) — OSHAL app package

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
