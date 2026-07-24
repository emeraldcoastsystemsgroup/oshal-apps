# finance ("Finance") — an OSHAL app package

Link your banks and brokerages via Plaid and see everything in one place — net worth,
accounts, holdings, spending — with a plain-English brief reasoned by the accountable
finance-analyst bot (cost lands in `chat_tasks` under its own agent id). Includes the
ADR-048 money-movement addendum: idempotency-keyed transfers via the provider-agnostic
`PaymentAdapter`, explicit-confirm gated (HTTP 428 `no-charge`), audit-tabled.

Carved out of OSHAL core 2026-07-17 — **ADR-085 Wave 1 carve #5, the finale**: with this
package installed, `swarm-apps/` in the framework repo carries no Wave-1 applications.

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | Manifest: one OIDC route, `finance-brief` workflow, ribbon tile, `forest` theme, `suite: ai-finance`, `uses: [payments]`. **No bots** (see below). |
| `src-routes/finance-routes.ts` | The controller: Plaid link/exchange/sandbox, sync→aggregate, brief (bot reasoning), pay/pay-status/payments, unlink, lazy `ensureFinanceSchema`. |
| `src-routes/finance-plaid.ts` | Self-contained Plaid client + aggregate builder (zero imports). |
| `routes/*.js` | **Compiled JS** the loader mounts (`oshal-app build` output). |
| `tools/finance.html` | The surface (link + dashboard + brief + send-money panel), served from this package dir. |

## What deliberately stays in the framework repo

- **The finance-analyst REAL bot-node (ADR-093 interim):** compose service `finance-bot`
  (codex, `requiresOwnNode`), the echo-registry entry (`a0…0044`), the persona
  `ai-lab/bot-personas/finance-analyst.yaml`, and `scripts/oshal-plaid.js` (the CLI the
  bot shells; mounted into its container from the repo). The manifest bot mapper only
  expresses inline concierges today, so the heavy-bot fragment is operator-applied —
  exactly the vids-operator arrangement. When ADR-093's node-pool target lands, this
  moves into the package.
- **`@/features/payments`** — pinned as the 11th kernel skill at this carve (it had been
  held in dist only by this app's import). Both this package and the payments package
  resolve it from the running framework dist.
- **`guest-demo-seed`** — core guest infrastructure that seeds demo finance rows on guest
  start; it is table-name-coupled and try/catch best-effort, so it works when this
  package is installed and no-ops cleanly on a kernel without it.

Env (deployment-level, on the api + finance-bot containers): `PLAID_ENV`,
`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_SANDBOX_INSTITUTION`, `PAYMENT_PROVIDER`,
`STRIPE_SECRET_KEY`. Not credentialed = the surface shows not-configured and nothing
syncs or moves.

## Install

```bash
node scripts/oshal-app.js install finance     # from an OSHAL checkout
```

Ships `status: active` (parity with core). The three `oshal_finance_*` tables stay in
place across the carve (lazy-DDL, tier-1 owner RLS at the chokepoint).
