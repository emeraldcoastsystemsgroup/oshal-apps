# Movies & TV — OSHAL app package

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
