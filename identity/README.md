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
