# Movies & TV — OSHAL app package

1.1.3 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

AI movies & TV concierge, carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2 carve #1).

Search films and shows (TMDB, operator/tenant key or `TMDB_API_KEY`-family env fallback),
see where each is streaming, watch trailers, get recommendations from the viewer's taste,
build a watchlist, and hand off showtimes. "Watch" opens TMDB's where-to-watch (JustWatch)
page; "Tickets" opens a Fandango search — OSHAL never streams or sells.

## Shape

- `oshal-app.yaml` — manifest: one OIDC route mount (`/api/movies`), `guestTier: blocked`
  request, `connectors: [tmdb]`, ticketType `movies` + concierge workflow. **No bots** —
  see below.
- `src-routes/movies-routes.ts` — the surface + API (compiled to `routes/` by
  `oshal-app build`). Serves the surface from this package's `tools/` via
  `ctx.appPackageDir`; lazy-creates the five `movies_*` tables with owner RLS at the
  chokepoint (`buildOwnerRlsPolicyStatements`).
- `src-routes/tmdb-client.ts` — the TMDB client (vendored app-owned sibling; v3-key/v4-JWT
  detection, title normalization, where-to-watch + Fandango links).
- `tools/movies-app.html` — the Movies surface.
- `migrations/048-movies-platform.sql` — idempotent belt-and-braces for the same five
  tables (safe on DBs where the old core migration already ran).
- `tests/movies-envelope.spec.ts` — the movies-owned pure-logic specs (envelope parse,
  TMDB key detection, title normalization), moved from core at the carve.

## The bot stays in the framework (ADR-093 interim)

`movies-concierge` (`b00b0000-0000-0000-0000-000000000001`) is a REAL bot-node: its own
compose container (`movies-bot`, port 3076), blocks in both framework registries, worker +
foundation personas, and the `moviesToolKit.js` / `scripts/oshal-tmdb.js` tool chain it
shells. That quadruple is the operator-applied first-party fragment and does not ship in
this package. `workflow.workerBot: movies-concierge` resolves against the framework's
static registry; the packaged `/chat` route reaches the same bot through
`ctx.orchestrator` with cost captured in `chat_tasks`.

Movies & TV 1.1.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/movies-app.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| movie-chat | concierge chat turn | T2 | none | disable | not yet measured | none recorded |
| movies-ticket | movie or TV request ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
