# Spotify — OSHAL app package

AI music concierge, carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2 carve #2 — the
first packaged `service-or-oidc` route mount).

Search the listener's Spotify, see what's playing and their playlists, get
recommendations from their taste, and build playlists on their own account (the
build-playlist tool is approval-gated). Playback is a deep-link handoff into the
listener's own Spotify app — no password or payment ever touches OSHAL.

## Shape

- `oshal-app.yaml` — manifest: one `service-or-oidc` route mount (`/api/spotify` — bots
  call it with the service secret + trusted sub, humans via OIDC), five route-backed
  framework tools (music-search, now-playing, list-playlists, build-playlist
  approval-gated, spotify-accounts), `guestTier: blocked` request,
  `connectors: [spotify]`, ticketType `spotify` + concierge workflow. **No bots** — see
  below.
- `src-routes/spotify-routes.ts` — the surface + API (compiled to `routes/` by
  `oshal-app build`). Serves the surface from this package's `tools/` via
  `ctx.appPackageDir`; lazy-creates the four `spotify_*` tables with owner RLS at the
  chokepoint; resolves service callers through `getTrustedServiceUserSub`.
- `spotify-client` is NOT vendored — it stays in the framework (`@/app/routes/spotify-client`)
  because the platform spotify connector runtime imports it (shared-slice rule); the packaged
  routes resolve it from the running dist like the concierge helpers.
- `tools/spotify-app.html` — the Music surface.
- `migrations/046-spotify-platform.sql` — idempotent belt-and-braces for the same four
  tables (safe on DBs where the old core migration already ran). 047 (bot seed) stays
  core with the bot.
- `tests/spotify-envelope.spec.ts` — the spotify-owned pure-logic specs (envelope parse,
  track normalization), moved from core at the carve.

## The bot stays in the framework (ADR-093 interim)

`spotify-concierge` (`b00a0000-0000-0000-0000-000000000001`) is a REAL bot-node: its own
compose container (`spotify-bot`), blocks in both framework registries, worker +
foundation personas, and the `spotifyToolKit.js` / `scripts/oshal-spotify.js` tool chain.
That quadruple is the operator-applied first-party fragment and does not ship in this
package. `workflow.workerBot: spotify-concierge` resolves against the framework's static
registry; the packaged `/chat` route reaches the same bot through `ctx.orchestrator`.
