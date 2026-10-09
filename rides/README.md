# Get a Ride — OSHAL app package

1.5.2 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

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

Get a Ride 1.4.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/rides-app.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

## Commerce surface (1.5.0)

- **Booking waits for the rider.** A chat turn in which the concierge sets `book` no longer
  builds the Uber deep link or writes `rides_requests`. The route prices the trip with the
  deterministic estimate and returns a `proposal` (`rideProposal`: pickup, destination, the
  matching ride type and its fare range, or "no fare estimate" when an address did not resolve);
  `ride` stays in the reply and is always `null`. The surface selects the proposed ride and shows
  a confirm card; only Confirm calls `POST /request`.
- **Assistant rail.** The manifest declares `surface.ops`
  (`context, set_field, field_change, custom, propose, submit, notify`). `tools/rides-app.html`
  loads the shared surface-bridge client and producer, marks pickup and destination as bridge
  fields, publishes the trip, the measured distance, the priced options and the selected ride as
  `context`, and applies the custom ops `estimate`, `select_ride` and `request_ride` through the
  same functions its buttons call. A ride from the floating assistant is the same confirm card.

## Family audience view (1.5.1)

The Home shell opens the map page as `/api/rides/app?audience=family` (ADR-164 D6). The shared
kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints "Getting
around": how many rides were planned, the five-day count from the home summary (handed to Uber),
when the last one was planned, the usual ride type, the newest ten rides (destination, pickup,
ride type and the estimate saved with it, or "no fare estimate saved") and the places asked for
most. On open it reads only `GET /history` and `GET /home-summary` under the caller's session:
no map or map config, no address lookup, no fare estimate, no concierge, no Uber link, no write.
A saved ride opens nothing, because its Uber link would start a booking; the one action opens
Get a Ride in the cockpit. No saved ride, a history at its 20-row cap, a summary that could not
be checked, a partial summary, 401, 403 and a failed read are each named. Any other request runs
the full map page unchanged; its boot, the assistant rail and the handoff and connected-actions
module are each gated on the kit's decision, so nothing but the view's own reads runs behind a
view, and a core without the kit runs the full page as before.

## Testing

Registered in `tests/test-lab.yaml`.

- `node --test "tests/*.test.js"` from this directory (the store-CI `rides` job): the map route
  and surface contracts, the chat-proposal hand-off boundary over the compiled route module
  (`tests/rides-routes-harness.js` is its in-memory pool and provider), and the assistant-rail
  contract.
- `OSHAL_CORE_DIR=<core checkout> node --test tests/surface.core.spec.mjs` is the 390 x 844
  Chromium commerce smoke over the compiled router, with the vendored map and local tiles; the
  framework-coupled gate discovers it.
- `node --test tests/audience-view.test.cjs` — the family audience view contract and behaviour
  (stub kit, stub fetch, stub DOM for the three gated start paths; no browser).
  `OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs rides` from the store
  root drives `tests/audience-view.fixture.cjs` over the real page and the real kit in headless
  Chromium.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| ride-chat | ride planning chat turn | T2 | none | disable | not yet measured | none recorded |
| rides-ticket | ride request ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
