# Eats — OSHAL app package

1.3.4 makes `GET /cart` a pure read: a diner with no cart yet gets `cartId`, `storeId` and `storeName` null and no
lines instead of a cart created by the read, which the native host refuses on a GET; the first add still creates the
cart. Proven by `tests/eats-routes.test.js` under a double of the native admission rule and by the Chromium smoke
`tests/surface.core.spec.mjs` (Test Lab cases `routes-money-handoff` and `surface-mobile-commerce`).

1.3.2 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

AI Uber Eats concierge, carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2 carve #4).

Search restaurants and dishes, build ONE Uber Eats order, learn the diner's cuisine +
dietary preferences, and hand off a ready Uber Eats checkout link. Uber has no consumer
API to place an order on a third party's behalf, so ordering is a deep-link handoff — the
diner signs in and pays on Uber. No payment or diner credentials touch OSHAL.

## Shape

- `oshal-app.yaml` — manifest: one `service-or-oidc` route mount (`/api/eats`), five
  route-backed framework tools (search / browse-menu / add-item / prepare-order
  approval-gated / ask-concierge), three ribbon tiles (Order Food / Restaurants / Order),
  `guestTier: blocked` request, `connectors: [uber]`, ticketType `eats` + concierge
  workflow. **No bots** — see below.
- `src-routes/eats-routes.ts` — the surface + API (compiled to `routes/` by
  `oshal-app build`). Serves the surface from this package's `tools/` via
  `ctx.appPackageDir`; lazy-creates the seven `eats_*` tables with owner RLS at the
  chokepoint; resolves service callers through `getTrustedServiceUserSub`; shells the
  framework-resident `scripts/oshal-uber.js` CLI (stays in the image — the eats-bot uses
  it too). Nothing vendors: every helper it imports (`concierge-reply`, `concierge-store`,
  `inline-bot-execution`, agent-management) is shared with other core apps.
- `tools/eats-app.html` — the Eats surface.
- `migrations/040-eats-platform.sql` — idempotent belt-and-braces for the seven tables.
  041 (bot seed) stays core with the bot.

## The bot stays in the framework (ADR-093 interim)

`eats-concierge` (`b0080000-0000-0000-0000-000000000001`) is a REAL bot-node: its own
compose container (`eats-bot`), blocks in both framework registries, worker + foundation
personas, and the `uberToolKit.js` / `oshal-uber.js` tool chain. That quadruple is the
operator-applied first-party fragment and does not ship in this package.
`workflow.workerBot: eats-concierge` resolves against the framework's static registry.

Eats 1.2.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/eats-app.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

## Commerce surface (1.3.0)

- **Menu-priced lines.** `POST /api/eats/cart/items` takes `storeId` and `productId` and prices
  the line from that restaurant's menu (the provider's `menu` operation), storing the menu's
  title, price, store and image. A price, title or store in the request body is ignored; a dish
  the menu does not list is refused with `422 unknown_item`. The `add-food-item` tool's input is
  `{ storeId, productId, quantity }` to match.
- **Integer-cent totals.** Every total (`GET /cart`, the add/remove responses, the order
  proposal, the recorded hand-off) is summed in whole cents by `src-routes/cart-totals.ts`. The
  cart responses keep `items` and `total` and add `totalCents` and `unpricedLines`.
- **Ordering waits for the diner.** A chat turn in which the concierge decides to order returns
  a `proposal` (`checkout` stays in the reply and is always `null`); it neither builds the deep
  link nor writes `eats_orders`. The surface shows it as a confirm card; only Confirm calls
  `POST /order`.
- **Assistant rail.** The manifest declares `surface.ops`
  (`context, set_field, field_change, custom, propose, submit, notify`). `tools/eats-app.html`
  loads the shared surface-bridge client and producer, publishes the restaurants or menu on
  screen and the order with its total as `context`, and applies the custom ops `search`,
  `open_menu`, `add_item` and `place_order` through the same functions its buttons call. Dishes
  the concierge shows in chat get working Add buttons.

## Family audience view (1.3.1)

The Home shell opens the first surface as `/api/eats/app?audience=family` (ADR-164 D6). The
shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints
"Food delivery": what is waiting in the order (the home summary's pending cart items, newest
first), the saved tastes (favorite food, dietary needs, budget per order, delivery address, in
the full page's words for what is not set), the recent checkout links (store, total, when) and
four counts (in the order now, checkout links in five days, saved checkouts, whether Uber Eats
is linked). On open it reads only `GET /home-summary`, `GET /profile`, `GET /orders/history`
and `GET /config` under the caller's session: never `GET /cart` (the full page's own order
read), never `GET /search` or `GET /menu` (the catalog provider), never the concierge,
never a write. Nothing in the view is clickable; the one action opens Eats in the cockpit, and
ordering stays in the full page. A partial summary, a side read that could not be checked, an
unlinked Uber Eats, 401, 403 and a failed summary are each named. Any other request runs the
full page unchanged: its start, the assistant rail and the handoff / connected-actions module
are each gated on the kit's decision, so nothing but the view's own reads runs behind a view.

## Testing

Registered in `tests/test-lab.yaml` (the package's first suites).

- `node --test tests/audience-view.test.cjs` — the audience view contract and behaviour (stub
  kit, stub fetch, stub DOM; no browser). `OSHAL_FRAMEWORK=<core checkout> node
  scripts/audience-views.browser.cjs eats` from the store root drives
  `tests/audience-view.fixture.cjs` over the real page and the real kit in headless Chromium.
- `node --test "tests/*-*.test.js"` from this directory (the store-CI `eats` job): the
  assistant-rail contract, the order-total known values, and the compiled-route money and
  hand-off boundary (`tests/eats-routes-harness.js` is its in-memory pool and provider).
- `OSHAL_CORE_DIR=<core checkout> node --test tests/surface.core.spec.mjs` is the 390 x 844
  Chromium commerce smoke over the compiled router; the framework-coupled gate discovers it.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| eats-concierge-chat | concierge chat turn | T2 | none | template | not yet measured | none recorded |
| eats-order-ticket | food order ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
