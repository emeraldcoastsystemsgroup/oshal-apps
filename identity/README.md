# Identity Hub (identity) — OSHAL app package

Every account you've connected, in one place. The hub is a click-to-access
launcher over the accounts you already authorized at `/utilities`: open a provider
directly, reconnect an expired login, or connect a new one — and ask the
**identity-advisor** for an optional access review ("what needs attention") that
reasons over connection METADATA only. No secret is ever shown, copied, or handed
back.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (ticketType `identity-review` + the
  Identity Access Review workflow), the `/api/identity` routes (surface + `/advice`
  — a VIEW over `/api/connect/list`), the hub surface (`tools/identity.html`), and
  a package copy of the identity-advisor persona for the registrar.
- **Stays in the OSHAL kernel:** the identity-advisor **inline node** (registered
  in both `swarm-bot-registry` blocks), the connector hub (`/api/connect/list` +
  `/api/connect/:provider/start` + the `/utilities` Connections page), and the
  shared helpers the routes import via `@/` aliases (`connector-tenancy`'s
  `accessibleConnections`, `inline-bot-execution`'s `executeBotOrInline`).

## Surfaces

Version 1.1.0 adds `GET /api/identity/summary`: a deterministic Home summary over the caller's
accessible connection metadata. Its selectable metrics are `saved-accounts`, `reconnect`,
`expires-7d` (nonrenewable authorizations expiring within seven days), `shared-accounts`, and
`providers`. A renewable access token is not counted as needing reconnection merely because its
expiry has passed. Provider liveness is not inferred from saved metadata. Shared accounts use the
existing membership-based access helper.

The GET performs no provider calls, token refresh, AI work, or database writes. Failed reads return
503 instead of zero; an authenticated caller with no saved accounts gets a truthful empty summary.
`tiles` retains four legacy values, `metrics` exposes the stable-id catalog, and related item
`metricId` values keep hidden facts out of highlights. All five metrics start selected. A core that
supports `metricsPointer` is required to load this manifest.

Acceptance harness: `identity/tests/home-summary.integration.cjs`, run from the matching core
checkout with `HOME_TEST_DATABASE_URL` pointing to a disposable local database named
`home_summary_test`. It creates and removes its own schema and restricted role, verifies real
PostgreSQL isolation and revision conflicts, mounts the compiled package route and real Home
preference route, and exercises Chromium on desktop/mobile. Its login is a fixture; it does not
claim acceptance against a user's live provider accounts.

| Tile | URL | What |
|---|---|---|
| Identity Hub | `/api/identity/` | Connected-accounts grid + open/reconnect/connect + access review (self-served by this package) |

## Install

```bash
node scripts/oshal-app.js install identity
```

No migrations — the hub reads the existing connector store; it owns no tables.
The access review runs on the identity-advisor (inline, cost lands in
`chat_tasks` under its agent_id) and never sees a token.
