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

## Test Lab catalog (1.1.1)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/identity-list-contract.test.js` | unit | Isolated Node runner; synthetic data only |
| `tests/home-summary.integration.cjs` | browser | Pending: standalone Node harness, matching core checkout, disposable PostgreSQL and Chromium |

The browser harness is deliberately not eligible for the isolated Node runner. Set `HOME_TEST_CORE` to the matching core checkout and `HOME_TEST_DATABASE_URL` to a dedicated localhost database named `home_summary_test`, then run `node identity/tests/home-summary.integration.cjs` from the store checkout. It creates and removes a random schema and role; screenshots remain in the core `output/home-summary-acceptance` directory. This registration does not report that fixture as executed.

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.
