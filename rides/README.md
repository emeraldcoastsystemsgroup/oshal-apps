# Get a Ride — OSHAL app package

AI Uber Rides concierge, carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2 carve #3).

Take a pickup + destination, show ride options (UberX/Comfort/XL/Black) with
clearly-labelled estimated fares, and hand off a ready m.uber.com universal deep link —
the rider confirms and pays in their own Uber app. No payment or rider credentials touch
OSHAL.

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
- `migrations/042-rides-platform.sql` — idempotent belt-and-braces for the same four
  tables. 043 (bot seed) stays core with the bot.

## The bot stays in the framework (ADR-093 interim)

`rides-concierge` (`b0090000-0000-0000-0000-000000000001`) is a REAL bot-node: its own
compose container (`rides-bot`), blocks in both framework registries, worker + foundation
personas, and the `uberRidesToolKit.js` / `oshal-uber-rides.js` tool chain. That
quadruple is the operator-applied first-party fragment and does not ship in this package.
`workflow.workerBot: rides-concierge` resolves against the framework's static registry.
