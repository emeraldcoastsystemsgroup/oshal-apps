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
| `tools/finance-app.html` | Finance as its own application (1.5.0): the page the menu opens first. See below. |

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

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document fail-closed Plaid-token recovery after removal of the public encryption-key fallback. -->

## `SESSION_SECRET` Plaid recovery

Set a nonblank `SESSION_SECRET` before linking or syncing accounts. Plaid access tokens encrypted
under the retired public fallback cannot be authenticated with a new secret; reconnect each linked
institution through Plaid Link. Existing aggregates and payment audit rows remain, but no ciphertext
should be copied into a token or configuration field.

## Test Lab catalog (1.2.1)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/session-crypto.test.mjs` | unit | Isolated Node runner; synthetic data only |

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.

## Finance as its own application (1.5.0)

Finance opens on `tools/finance-app.html`, served at `GET /api/finance/app` (`finance-app` is the first tool and `ribbon.defaultView`). The page takes the whole window: opened inside the cockpit it hides the cockpit's header and menu and shows its own bar.

- **The bar** is read from `GET /api/ui/profile?name=finance`, so it lists the sections this menu really has, in the manifest's order: Home, Money (`/api/finance/`), Trades (`/api/trading/`), World (`/api/world/app`), Markets (`/api/kalshi/`), Recap (`/api/daily-trade-recap/review`), and Linked banks under More. A phone gets a bottom bar with the first sections and More.
- **A section opens inside the page**, in a frame under the bar. The address keeps the section (`#/finance-trading`), so a reload or a shared link returns to it.
- **Home** reads four summaries, each from its own application (`/api/finance/home-summary`, `/api/trading/home-summary`, `/api/kalshi/home-summary`, `/api/daily-trade-recap/home-summary`), and the person's jobs from `GET /api/v1/agent/schedules`, keeping the jobs of those four applications. It shows the first two tiles of each summary, each job with its last run, result, next run and run counts, and up to three notes from each summary, with anything that needs attention first. A summary that does not answer is said in words ("Markets: could not be read just now."); the others still show. A summary is asked for only when its section is in the person's menu.
- **It only reads.** The page makes GET requests and has no control that changes a job, a bank link or an order. Turning a job on or off is done on the Jobs page (`/swarm-admin/jobs`), which Home links to.

Tests: `tests/finance-app.test.cjs` (manifest, route, and the page's own wording functions) and `tests/browser/finance-app.browser.test.cjs` (Chromium with stand-in answers, desktop, phone and inside a cockpit-like page). Not yet proven against a signed-in session on a running kernel by these tests; that check is done on the test slot before delivery.

## Overview Aggregate Normalization & Sortable Table Enhancement (1.4.2)

- **Backend Aggregate Normalization (`routes/finance-routes.js`):** `normalizeAggregate()` guarantees that `GET /api/finance/summary` always returns well-formed arrays (`accounts: []`, `holdings: []`, `recentTransactions: []`, `spendingByCategory: []`) and numeric totals (`netWorthCents: 0`, `assetsCents: 0`, `liabilitiesCents: 0`) even when a stored aggregate row omits an array field or no accounts are linked yet.
- **Container-Safe Table Enhancement (`tools/finance.html`):** `enhanceTables(root)` resolves every `<table class="data-table">` inside the rendered tab container before invoking `window.KernelTable.enhance(table)` and guards all array length accesses (`Array.isArray(...)`) across the Overview, Accounts, Holdings, Transactions, Payments, and Subscriptions views.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| money-brief | money brief | T3 | none | disable | not yet measured | none recorded |
| context-review | draft review against your finances | T3 | none | disable | not yet measured | none recorded |
| finance-brief-ticket | finance brief ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
