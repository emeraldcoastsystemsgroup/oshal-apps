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
| `src-routes/finance-analysis.ts` | A requested analysis that runs after the press has answered (1.6.5): the kernel's background-run port, the caller's one request row and what it reads as. |
| `migrations/` | The stores the routes also create lazily: 001 the three finance stores, 002 the caller's latest analysis request. |
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

## Saved account figures and analysis (1.6.2)

Bank Sync uses the native Plaid adapter on the native runtime. A missing amount stays Unknown; a reported zero remains zero. An unreadable institution leaves complete totals unknown. Account figures retain their reported currency, and different currencies are not added without conversion. Saved summaries and analysis apply the same limits without rewriting historical stored snapshots. Jarvis's Finance facts also keep the holdings count and value unknown when the inventory is incomplete, missing or malformed; an explicitly complete empty inventory remains zero.

Request analysis uses one saved snapshot. If Sync replaces that snapshot while analysis is running, the request refuses with an explanation and preserves the previous analysis and its saved date. Request analysis again to use the newer snapshot.

Focused tests exercise the actual native adapter, compiled handlers, actual pages with synthetic replies, and a separate native-adapter-to-page contract. Native SQL comparison is checked against memory and disposable PostgreSQL. These tests do not establish live bank freshness or investment performance.

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

## Request analysis works after the press (1.6.5)

One turn of a slow model takes longer than the 60 seconds the kernel gives one package request, so with 1.6.4 an analysis often could not finish. On a kernel that can run a turn in the background (`@/shared/package-runs` has `backgroundTurn`), Request analysis now answers at once:

- `POST /api/finance/brief/refresh` records the request as working in `oshal_finance_analysis` (one row a person, migration 002) with the exact snapshot it reads, asks the kernel for one turn of the finance-analyst with a five minute limit, and answers 202. The analyst is not asked inside the request.
- The kernel runs the turn and hands the answer to `POST /api/finance/brief/analysis-result` as the same person. That route takes only the kernel's hand-over (its `x-oshal-trigger` header is one the HTTP door never forwards from a browser) and only for the working request. It writes the figures in code as always, leaves out a sentence that states an unlisted amount with the visible note, and saves the analysis only over the snapshot it was asked about. It asks the analyst nothing: a turn inside that request would outlast it, so the one rewrite of the 45 second path is not asked here.
- `GET /api/finance/brief/analysis` (and `analysis` on `GET /api/finance/brief` once a request exists) says working, done or failed. The page shows "Your finance analyst is working on a new analysis" above the earlier analysis, asks every five seconds, and shows the new analysis when it is saved. The earlier analysis stays until then.
- A failure is said in words and nothing is saved: the analyst did not answer within 5 minutes, could not answer, or the account snapshot changed meanwhile. A request the kernel no longer holds (a restart ends its runs), or one past its time, reads as not finished.
- One request runs at a time. A second press while one is working answers working and starts nothing.

Without that kernel ability, on another platform, or when the kernel cannot start the turn, the 45 second path of 1.6.4 answers in the same press, unchanged.

Tests: `tests/analysis-background.test.cjs` (the compiled routes with the store and the kernel's port doubled) and six cases in `tests/browser/finance-bank-snapshot.browser.test.cjs` (Chromium, stand-in answers, the browser's clock driven by the test). The kernel's side is proved in the kernel repository by `crates/oshald/tests/package_background_turn.rs` with a fixture application; Finance itself is not yet proven against a running kernel by these tests, and that check is done on the test slot before delivery.

## Request analysis, the Concierge and category names (1.6.4)

Request analysis answers within 45 seconds, inside the 60 seconds the kernel gives one package request. When the analyst has not answered by then, the page says that nothing was saved and the earlier analysis is unchanged; a refused analyst is said the same way, and a request the kernel ends with only a status code reads as a sentence, never "HTTP 503". The one rewrite of a commentary that states an unlisted amount is asked only while 15 seconds are left; otherwise the unmatched sentence is left out with the visible note. The wait says up to a minute and a second press cannot start meanwhile.

Inside the cockpit Finance still owns the window, but its concierge (the chat panel the Concierge button opens) is hidden only while closed: open, it sits beside the page on a computer and covers it on a phone.

Spending categories read as words ("Transfers out", "Loan payments", "Food and drink") on the bank page and in the household and company views.

## Transaction coverage (1.6.3)

After Sync, the bank view shows whether the requested transaction window is complete, partial or unknown, with available and expected row counts when known. Available transactions and independently known balances stay visible. Full-window spending, income and category totals remain unknown when the window is incomplete. An explicitly complete empty window retains known zero.

New analysis and specialist answers use the same coverage boundary, including older saved snapshots with numeric rollups but missing or contradictory completeness evidence. Sync preserves an independently dated saved analysis. Coverage describes the provider's requested window; it does not establish investment returns or explain account losses.
