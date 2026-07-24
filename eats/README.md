# Eats — OSHAL app package

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
