# Shopping — OSHAL app package

1.3.4 makes `GET /cart` a pure read: a shopper with no list yet gets `listId: null` and no lines instead of a list
created by the read, which the native host refuses on a GET. The chat surface creates the default list through
`POST /lists` before its first add. Proven by `tests/shopping-routes.test.js` under a double of the native admission
rule and by the Chromium smoke `tests/surface.core.spec.mjs` (Test Lab cases `routes-money-handoff` and
`surface-mobile-commerce`).

AI shopping concierge (Walmart), carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2
carve #5).

Search real retailer catalogs (Walmart I/O Affiliate API), build and display shopping
lists, learn each shopper's preferences, watch deal feeds, and — because it lives in the
swarm — answer other bots that need a purchase prepared. Retailers complete payment on
their own domain; this app builds the basket and hands off a tracked checkout link. No
shopper money or credentials touch OSHAL.

## Shape

- `oshal-app.yaml` — manifest: one `service-or-oidc` route mount (`/api/purchasing`), six
  route-backed framework tools (search / compare / scan-deals / suggest-from-history /
  explain-pick / prepare-checkout approval-gated), four ribbon tiles (chat / dashboard /
  lists / deals), `guestTier: blocked` request, `connectors: [walmart]`, ticketType
  `purchasing` + concierge workflow. **No bots** — see below.
- `src-routes/purchasing-routes.ts` — the API + two surfaces (compiled to `routes/` by
  `oshal-app build`). Serves both surfaces AND `purchasing.css` from this package's
  `tools/` via `ctx.appPackageDir`; lazy-creates the eight `shop_*` tables with owner RLS
  at the chokepoint; resolves service callers through `getTrustedServiceUserSub`; shells
  the framework-resident `scripts/oshal-walmart.js` CLI (stays in the image — the
  shop-concierge bot shares it). Nothing vendors: `concierge-reply` and the broker/authz
  helpers it imports are core-shared.
- `tools/shopping-chat.html`, `tools/shopping-dashboard.html`, `tools/purchasing.css` —
  the two surfaces and their shared stylesheet (the dashboard loads
  `/api/purchasing/purchasing.css`).
- `migrations/035-…`, `037-…`, `038-…` — idempotent belt-and-braces for the eight tables.
  036 (bot seed) stays core with the bot.

## The bot stays in the framework (ADR-093 interim)

`shopping-concierge` (`b0070000-0000-0000-0000-000000000001`) is a REAL bot-node: its
compose worker, blocks in both framework registries, worker + foundation personas, and
the `walmartProvider.js` / `walmartToolKit.js` / `purchasingTools.js` / `oshal-walmart.js`
tool chain. That quadruple is the operator-applied first-party fragment and does not ship
in this package. `workflow.workerBot: shopping-concierge` resolves against the framework's
static registry.

## Commerce surface (1.3.0)

- **Server-priced lines.** `POST /api/purchasing/lists/:listId/items` takes a `productId`
  (and optionally a title as a search hint) and prices the line from the Walmart catalog row
  whose id matches exactly. A price, brand or image in the request body is ignored; an id the
  catalog cannot confirm is refused with `422 unknown_product` and nothing is stored. A body
  with a `title` and no `productId` stays a free-text list entry (what the Homebase list adds):
  stored with no product and no price, counted in `unpricedLines`, and left out of checkout.
- **Integer-cent totals.** Every total (`GET /cart`, the checkout proposal, the recorded
  hand-off) is summed in whole cents by `src-routes/cart-totals.ts`. `GET /cart` keeps its
  `{ listId, items, total }` shape and adds `totalCents` and `unpricedLines`. It is a pure read: a
  shopper with no list gets `listId: null` and no lines, and the first add creates the list.
- **Checkout waits for the shopper.** A chat turn in which the concierge decides to check out
  returns a `proposal` (`checkout` stays in the reply and is always `null`). The surface shows it
  as a confirm card; only Confirm calls `POST /checkout`, which builds the Walmart link and writes
  `shop_purchase_history`.
- **Assistant rail.** The manifest declares `surface.ops`
  (`context, set_field, field_change, custom, propose, submit, notify`). `tools/shopping-chat.html`
  loads the shared surface-bridge client and producer, publishes the cart, its total, the ship
  address and the products on screen as `context`, and applies the custom ops `search`,
  `add_product` and `checkout` through the same functions its buttons call. A checkout from the
  floating assistant is the same confirm card.

## Family audience view (1.3.1)

The Home shell opens the dashboard as `/api/purchasing/dashboard?audience=family` (ADR-164 D6).
The shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints
"Our list": the active list's name, its pending lines (quantity, price, when added), the other
lists as tiles, and four counts (on the list, lists, last added, checkout links in five days —
not confirmed purchases). On open it reads only `GET /lists`, `GET /lists/:id/items` and
`GET /home-summary` under the caller's session: no catalog call (search, deals, resolve), no
concierge, no write. The one action opens Shopping in the cockpit; adding and removing stay in
the full page and the homebase's own shopping module. No list, an empty list, a summary that
could not be checked, 401, 403 and a failed read are each named. Any other request (including
the page's own `?view=lists|deals` tabs) runs the full dashboard unchanged; its tab router is
gated on the kit's decision, so nothing but the view's own reads runs behind a view.

## Company and family views on the concierge page (1.3.2)

The concierge chat page (`/api/purchasing/chat`) is Shopping's first surface, so it is the page the
Studio, Orbit and Commons shells frame with `?audience=company` and Jarvis frames with
`?audience=family`. It now answers both from the same three reads as the dashboard's view
(`GET /lists`, the active list's `GET /lists/:id/items`, `GET /home-summary`):

- **Company** ("Productivity · Shopping"): the cart's line count as the title, four stats (cart
  lines; the cart total in whole cents, counted the way `src-routes/cart-totals.ts` counts it, with
  the lines that have no price named; active lists and how many are archived; checkout links in five
  days, not confirmed purchases), the cart as a table newest first (quantity, unit and line price,
  when added) and the lists as a table with the cart's list marked.
- **Family** ("Our list"): the household list in the dashboard's own words.

It never reads `/cart` (the concierge's own read), `/deals` or `/search` (the Walmart catalog),
the concierge or the profile, and writes nothing; the escape opens Shopping in the cockpit. No list,
an empty list, a summary that could not be checked, 401, 403 and a failed read are each named. The
concierge start, the assistant rail and the handoff module are gated on the kit's decision, so any
other request runs the full page unchanged. The dashboard's family view is unchanged.

## Testing

Registered in `tests/test-lab.yaml`.

- `node --test tests/audience-view.test.cjs` — the audience view contract and behaviour of both
  pages (stub kit, stub DOM; the chat page's views run over the package's real list and
  home-summary handlers with stub pools; no browser). `OSHAL_FRAMEWORK=<core checkout> node
  scripts/audience-views.browser.cjs purchasing` from the store root drives both entries of
  `tests/audience-view.fixture.cjs` over the real pages and the real kit in headless Chromium.

- `node --test "tests/*-*.test.js"` from this directory (the store-CI `purchasing` job): the
  assistant-rail contract, the cart-total known values, and the compiled-route money and
  hand-off boundary (`tests/shopping-routes-harness.js` is its in-memory pool and provider).
- `tests/walmart-catalog-policy.spec.ts` runs under the framework-coupled Vitest config
  (`node scripts/security/run-framework-coupled-tests.mjs --store . --framework <core checkout>`).
- `OSHAL_CORE_DIR=<core checkout> node --test tests/surface.core.spec.mjs` is the 390 x 844
  Chromium commerce smoke over the compiled router; the framework-coupled gate discovers it.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| shopping-chat | shopping chat turn | T2 | none | disable | not yet measured | none recorded |
| shopping-ticket | shopping request ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
