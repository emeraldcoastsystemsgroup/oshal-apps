# Shopping — OSHAL app package

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
