# Get a Ride — OSHAL app package

AI Uber Rides concierge, carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2 carve #3).

Take a pickup + destination, show ride options (UberX/Comfort/XL/Black) with
clearly-labelled estimated fares, and hand off a ready m.uber.com universal deep link —
the rider confirms and pays in their own Uber app. No payment or rider credentials touch
OSHAL.

## The map (1.1.0)

**Default: OpenStreetMap, keyless.** The surface draws real tiles under the Leaflet build
vendored at `tools/vendor/leaflet` (BSD-2-Clause, see that directory's README for why it is
vendored rather than pulled from a CDN). Pickup and destination are draggable pins; clicking the
map sets whichever point is armed and reverse-geocodes it to a street address. Nothing needs to be
configured for this — it is what a fresh clone gets.

**Optional upgrade: Google Maps.** Set `GOOGLE_MAPS_BROWSER_KEY` (and optionally
`GOOGLE_MAPS_MAP_ID`) in the framework `.env` — the compose file passes both through — and the same
surface switches to Google, which buys a road-routed polyline instead of a straight line, and Places
autocomplete instead of on-demand lookup. A key that fails to load falls back to OSM rather than to
nothing. `OSHAL_MAP_TILE_URL` points the OSM path at your own tile server.

**Geocoding** runs server-side through `scripts/oshal-uber-rides.js` (`geocode` / `reverse`),
proxied by `GET /api/rides/geocode` and `GET /api/rides/reverse`. It goes through the CLI rather
than the browser so Nominatim sees one caller honouring its terms — real User-Agent, serialized to
~1 req/s, cached per process. That policy also forbids autocomplete-style querying, which is why
address lookup fires on blur/Enter and not on every keystroke.

**Fares are modelled on a measurement.** The estimate geocodes both ends, takes the haversine
distance, and applies a road factor; the response carries `coords`, `straightLineKm`, `distanceKm`
and `basis`. When `basis` is `unresolved` — an address did not geocode — every fare is `null` and
the surface says there is no estimate. Before 1.1.0 the distance was a SHA-256 hash of the two
address strings, so the same trip typed two ways quoted two different prices; guards against that
returning live in `tests/` here and in the framework's `tests/unit/uber-rides-estimate.spec.ts`.

## Shape

- `oshal-app.yaml` — manifest: one `service-or-oidc` route mount (`/api/rides`),
  route-backed framework tools, `guestTier: blocked` request, `connectors: [uber-rides]`,
  ticketType `rides` + concierge workflow. **No bots** — see below.
- `src-routes/rides-routes.ts` — the surface + API (compiled to `routes/` by
  `oshal-app build`). Serves the surface from this package's `tools/` via
  `ctx.appPackageDir`; lazy-creates the four `rides_*` tables with owner RLS at the
  chokepoint; resolves service callers through `getTrustedServiceUserSub`; shells the
  framework-resident `scripts/oshal-uber-rides.js` CLI (stays in the image — the
  rides-bot uses it too). Nothing vendors: every helper it imports (`concierge-reply`,
  `concierge-store`, `inline-bot-execution`, agent-management) is shared with other core
  apps and resolves from dist.
- `tools/rides-app.html` — the Rides surface.
- `tools/vendor/leaflet/` — the pinned Leaflet 1.9.4 dist, served by the package's own
  `/api/rides/vendor` static mount. Third-party, unmodified, licence included.
- `tests/*.test.js` — dependency-free `node --test` guards (store-CI contract): the map/provider
  contract, the geocoding proxy's validation + auth, and a parse guard over the served HTML.
- `migrations/042-rides-platform.sql` — idempotent belt-and-braces for the same four
  tables. 043 (bot seed) stays core with the bot.

## The bot stays in the framework (ADR-093 interim)

`rides-concierge` (`b0090000-0000-0000-0000-000000000001`) is a REAL bot-node: its own
compose container (`rides-bot`), blocks in both framework registries, worker + foundation
personas, and the `uberRidesToolKit.js` / `oshal-uber-rides.js` tool chain. That
quadruple is the operator-applied first-party fragment and does not ship in this package.
`workflow.workerBot: rides-concierge` resolves against the framework's static registry.
