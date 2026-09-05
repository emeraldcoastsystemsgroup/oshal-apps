# Intelligent Trades (`trading/`)

Signal-justified stock trading (ADR-052) — carved out of OSHAL core 2026-07-20
(ADR-085 Wave 3, "skill with a surface"). **Install by directory name:**
`node scripts/oshal-app.js install trading` — the app's registered NAME stays
`intelligent-trades` (the exact identity the kernel manifest carried), so
`?app=intelligent-trades` URLs, the default tile, guest-tier records, and the
`intelligent-trades` queue id survive unchanged.

## What this package is

- The four route surfaces the kernel used to hard-mount, byte-identical bodies:
  - `/api/trading` (`service-or-oidc`) — surface + book reads, signal → decision →
    order flow, `POST /trigger` (its route-level live-approval gate ships verbatim:
    live tickets park in `backlog`; paper auto-approves), algo + tuning routes.
  - `/api/trading/autopilot` (`service-or-oidc`) — the operator switch over the
    kernel-resident advisor schedules (the loops themselves stay kernel).
  - `/api/trading/lab` (`service-or-oidc`) — the ADR-092 Strategy Lab (backtests,
    forward walks, regressions, ADR-095 apply/revert with its confirm guard) plus
    the **Strategy Studio** conversational endpoints (`POST /draft`, `POST /studio`).
  - `/api/trading-charts` (`public`, self-guarded) — the vendored chart lib
    (public MIT asset from `tools/vendor/`) + `GET /bars` (callerSub 401).
- `tools/trading.html` + `tools/vendor/lightweight-charts.js` (the surface).
- Registrar COPIES of the three personas (trading-analyst, trading-research-analyst,
  weather-analyst) — the kernel registry entries + ai-lab personas stay framework-resident.
- The five `trading_*` cli tools over the KERNEL-resident `scripts/oshal-trade-ops.js`.
- `tests/` — the guards that carved WITH their subjects:
  `trading-performance-fallback.spec.ts` (the /performance SPY-base regression),
  `trading-surface-live-gate.spec.ts` (the surface's live/confirm gates), and
  `trading-strategy-studio-refine.spec.ts` (the Studio refine-in-place contract).

## Using the surface (ADR-136)

The surface (`tools/trading.html` + `tools/ui/*.js`, served at `/api/trading/`) has four top-level
views — **Accounts · Strategies · Research · Reports** — in the header nav, plus one account-detail
screen reached by clicking a tile. There is no ten-tab bar and no "Accounts & books" tab; every tab
the surface used to carry lives in exactly one of the five screens below.

The cockpit's bottom status bar (bots / tickets / cost / queue depth) is hidden while this app is
focused: the manifest sets `ribbon.hideStatusBar: true` (1.9.1) because that bar is swarm-operator
telemetry, not trading state. A plain `/cockpit/` still shows it.

- **Accounts (landing).** One tile per account: equity, day P&L, the strategy it runs (or
  "Production baseline" if none is set), a TRADING / VIEW-ONLY pill, and Start/Stop for a live
  account. Above the tiles: a consolidated total value and day change across every account. Below:
  a cross-account open-positions rollup (which account each position is held in) and the discovered
  Schwab accounts roster with **Discover accounts**. Click a tile to open that account; Paper is one
  tile like any other, labelled "Paper (reference book)".
- **Account detail** (a tile, or the header's account switcher/`← All accounts`). Holds only that
  account's concerns: KPI strip; **Buy a stock**; open positions; the focus pane (chart, signal
  model, order ticket — opens when you click a position); and the account's own Trade journal +
  Performance sub-tabs. The header shows the account's strategy line with an inline **Set** /
  **Reset** control next to it — changing strategy never requires leaving the account.
- **Strategies.** The **Account strategies** roster is the first sub-tab — one row per account, what
  it runs, and Set/Reset — because this is where you choose what each account trades. Every account
  always runs exactly one strategy: a saved one from the Strategy Library, or the Production
  baseline by default. Strategy Lab, Strategy Studio, and Tuning follow as the remaining sub-tabs
  (design/backtest/apply and the conversational Studio described below).
- **Research** (market-wide, not account-scoped). Recommendations, Algorithms, and Capture &
  signals. A signal or decision made from here files against the account currently selected in the
  header's account switcher.
- **Reports.** Performance and Trade journal, each with its own account selector so you can flip
  accounts without leaving Reports. Cross-account positions live on the Accounts landing page, not
  here.

Deep links: `?view=accounts|strategies|research|reports` for the four top-level views, and
`?view=account&book=<ref>&sub=journal|perf` for a specific account's journal or performance sub-tab.
Legacy `?tab=` links (`journal`, `perf`, `lab`, `studio`, `tuning`, `accounts`, `reco`, `algos`,
`capture`, `summary`) still resolve — they map onto the view above that now holds that content.

### Buy a stock (direct trades, ADR-136 D3)

**Buy a stock** on an account's detail page opens a 3-step ticket:

1. **Pick the stock** — type a ticker or a company name into the searchable dropdown (1.9.0,
   `GET /api/trading/symbols/search` over the market-wide asset directory: exact symbol first, then
   symbol prefix, then name) and look it up (`GET /api/trading/quote`). The last price re-polls every
   5 s with a Refresh button and an as-of time; the chart and signal model open alongside while you
   size the order, and the line under the price shows what is available to spend (buying power, else
   cash) or, for a sell, what you hold.
2. **Size & price rule** — shares, a dollar amount, or a percent of available funds (1.8.1; whole
   shares, rounded down; a sell is capped at what you hold, and a one-click *Sell all* is offered), and
   a plain-word price rule that maps onto the same order types the broker already runs:
   - *Buy now at market* → `market`
   - *Only if it drops to a price* → `limit`
   - *Only once it breaks above a price* → `stop`
   - *Break above, but not more than* → `stop_limit`
   - *Protect with a trailing stop* (sell-side only) → `trailing_stop`
   Time in force is **Today only (day)** or **Until cancelled (GTC)**. A *limit* rule may be marked
   eligible for pre/post-market (1.8.1, `extendedHours` — never a market order).
3. **Confirm** — names the account and shows the order in one sentence plus the estimated total. A
   live account requires an explicit confirm before anything is sent.

**Protect these shares** (1.8.0, ADR-138 D3): a BUY may carry exit rules — take-profit (percent *or*
price), a stop (percent *or* price) *or* a trailing stop (percent), and a time stop (days). The server
mints a **protected lot** against the decision; once the entry fills, the trading leg places the exits
at the venue as GTC orders (take-profit LIMIT; STOP or TRAILING_STOP), and a fill cancels its sibling.
Protected shares are ring-fenced from the autopilot: rotation, trims and protective exits see the
symbol's quantity minus its pinned shares, so only the lot's own rules ever sell them. The account
page's **Protected lots** card lists them (rules in the same words the ticket used, the exit prices
actually placed, status) with **Release**, which cancels the working exits and hands the shares back
to the account's strategy.

**When** (1.9.2, ADR-136 D4): step 2 also asks *Now* or *At a time (ET)*. A timed order is minted
now but placed later by the trading leg at the chosen Eastern time — a trading day, 9:00 AM–4:55 PM,
on the 5-minute grid the leg ticks on (what you pick is when it fires), within the server's horizon
(`TRADING_DATED_MAX_DAYS`). There is no Place step: the review is the commitment, so a live account
confirms *before* the mint. The account page's **Timed orders** card lists pending ones with Cancel;
once fired the order is an ordinary Trade-journal entry. A window missed by more than the grace
(`TRADING_DATED_LATE_MINUTES`) expires unfired rather than placing a stale order. Protection rules
may ride along; the lot's unfilled-entry release then counts from the fire time.

Direct trades do **not** follow the account's strategy — there is no signal generation involved —
but they pass through the identical guardrails, live gate, submission-reservation arbiter, and
disabled-book refusal as every strategy-originated order; there is one order path, not two.

### Research a stock, watchlist, market movers (1.8.0–1.9.0, ADR-138)

The **Research** view's first sub-tab, *Research a stock*, puts one symbol on one screen
(`GET /api/trading/research/:symbol`): the latest quote, EDGAR fundamentals, the last week of news,
the recent 10-K / 10-Q / 8-K filings with 8-K items decoded, and the earnings cadence (the next
expected date from the world calendar when it has one, otherwise an estimate from the filing
cadence, labelled as such), plus **Buy** (opens the ticket pre-filled on the selected account) and
**Watch**. The per-user **watchlist** (`GET`/`POST /api/trading/watchlist`,
`DELETE /api/trading/watchlist/:symbol`) is yours alone (owner row-level security) and feeds the
movers report. *Market movers* (`GET /api/trading/reports/movers?kind=winners|losers|volatile|active`)
ranks the platform universe **plus your watchlist** from daily bars and says so on the surface — on
the free IEX feed the bars are end-of-day, so this is a canned report over that set, not a
whole-market screener (see the BACKLOG entry). The other Research sub-tabs — *Recommendations*,
*Algorithms*, *Capture & signals* — are the pre-existing research tools moved under this view.

### Event playbooks — the Anthropic IPO plan (1.7.0, ADR-136 D6)

An **event playbook** is a plan on one account that fires on a market event instead of a signal.
v1 is the IPO playbook: the Strategy Studio recognises an IPO request (issuer, "get in as early as
possible", take-profit and stop percentages, size as a percent of the account or in dollars, a time
stop, an entry deadline) and designs a plan against the IPO research findings, saving it as a draft
and returning a **dry run** (the orders it would place at example IPO prices) rather than a backtest,
since an unlisted stock has no history. Arming is confirm-gated. Once armed, the trading leg watches
EDGAR for the public S-1/F-1 and then the pricing prospectus (424B4 — IPO price and ticker parsed;
you may also enter both), waits for the first trade in a regular session, enters with a day LIMIT at
IPO price × (1 + the premium cap), and on a fill places the take-profit LIMIT and stop as GTC orders;
one filling cancels the other, and a time stop sells at market. Plans live under **Strategies →
Event playbooks** and on the account page (arm / disarm / delete). Routes: `GET`/`POST
/api/trading/events/plans`, `GET`/`PATCH`/`DELETE /api/trading/events/plans/:id`, `POST
/api/trading/events/plans/:id/arm` (428 without confirm) and `/disarm`. Not automated, by design: the
Schwab Conditional Offer to Purchase and its post-pricing confirmation are manual steps the dry run
lists; a reminder sequence for them is in the BACKLOG.

### API added in 1.6.0

- `GET /api/trading/quote?symbol=` — latest price for the selected account's book (Alpaca for paper,
  Schwab for a live account); 503 if market data isn't connected for that book.
- `POST /api/trading/decisions/manual` — mints the operator-authored decision the ticket then
  executes with the existing `POST /api/trading/orders`. Body: `symbol`, `side` (`buy`/`sell`),
  exactly one of `qty` or `notional`, `orderType` (`market`/`limit`/`stop`/`stop_limit`/
  `trailing_stop`), the matching `limitPrice`/`stopPrice`/`trailPercent`/`trailPrice`,
  `timeInForce` (`day`/`gtc`), optional `rationale`, and `book`/`mode` (also accepted as query
  params, query wins). Returns `decisionId`, `refPrice`, `estNotional`, and `requiresConfirm`.
- Static UI modules at `/api/trading/ui/*` (`app.js`, `ticket.js`, `shared-positions.js`,
  `view-accounts.js`, `view-account.js`, `view-strategies.js`, `view-research.js`,
  `view-reports.js`) — same-origin, auth-gated the same way as the rest of the surface.

### API added in 1.7.0–1.9.0

- 1.7.0 — the event-playbook routes listed above; the Studio's event mode answers a plan + dry run.
- 1.7.1 — `POST /api/trading/strategies/:id/backtest` accepts `startCash` (the Studio passes the
  selected account's equity), so a $500K account and a $20K account no longer backtest identically;
  the headline metric is `alphaVsSpyPct` (total return minus SPY over the same window).
- 1.8.0 — `GET /api/trading/research/:symbol`; the watchlist routes; `GET /api/trading/lots` and
  `POST /api/trading/lots/:id/release` (428 without `confirm`); `POST /api/trading/decisions/manual`
  accepts `protect` (the exit-rule set) and `extendedHours`.
- 1.8.1 — the ticket options above (buy on any account regardless of the autopilot flag, % / $ /
  shares sizing, available funds, 5-second quote poll).
- 1.9.0 — `GET /api/trading/symbols/search?q=&limit=` (limit capped at 25) and
  `GET /api/trading/reports/movers?kind=`.

### API added in 1.9.2 (timed orders, ADR-136 D4)

- `POST /api/trading/decisions/manual` accepts `fireAtEt: { date: 'YYYY-MM-DD', time: 'HH:MM' }`
  (Eastern wall-clock). The response then carries `dated` (the kernel row plus `fireAtWords`) and the
  caller must **not** call `POST /orders` — the trading leg places it at that time. 400
  `fire_at_invalid` says why a time is refused; 503 `scheduler_unavailable` is answered *before*
  anything is written when the leg cannot be armed.
- `GET /api/trading/dated` — the selected book's timed orders, soonest first.
- `POST /api/trading/dated/:id/cancel` — cancels a pending one (409 `not_pending` once it has fired).

## Strategy Studio (conversational design + refine-in-place)

The **Strategy Studio** tab is a chat (typed or spoken) with the trading-analyst bot.
A message becomes a research-grounded design: the analyst cites the curated corpus in
`src-routes/trading-strategy-research.ts` (invented citations are dropped at parse),
drafts a `StrategyConfig`, saves it to the caller's Strategy Lab as a candidate, runs
a real ~2-year backtest, and narrates the result (shown + spoken via `/api/voice`).

Follow-up messages **refine the SAME strategy in place** (the workflow-assistant
contract): the current config feeds back into the prompt, only what was asked
changes, and the store resets the forward walk + baseline on the config change.
An unmappable or ambiguous ask returns `{ needsInput, message }` — a clarifying
question in the chat — never an error. Blends are refused conversationally (their
components are embedded snapshots; rebuild them in the Lab). Prompt + parse live in
`src-routes/trading-strategy-studio-prompt.ts`.

Going live stays human-gated: the studio result's **Apply live…** button runs the
same percent-of-profile prompt + `confirm:true` gate as the Lab's Apply, and refining
a strategy that is currently applied never touches the live override (it keeps its
embedded snapshot until re-applied — the response says so explicitly).

## What stays in the OSHAL framework (ADR-093)

The ENGINE and the autopilot: `src/features/trading` (broker adapters, market data,
algorithms, sizing, risk policies), every `src/app/trading-*.ts` module —
`trading-engine.ts` (`placeDecisionOrder` with the env-level `live_blocked` gate:
`TRADING_LIVE_ENABLED` + explicit confirm — kernel-guarded by
`tests/unit/risky-write-guards.spec.ts`), `trading-schema.ts`, the 8
dispatch/reconcile loops, the strategy-lab sim/ops/store, config overrides,
strategy params, the equity/rotation/peaks stores — plus
`trading-routes-helpers.ts`, the bot containers + registries, migrations
034/035/072, all `TRADING_*` env, the schedule pins, `strategy-log.md`, the
watchdog + daily-recap CLIs, and the default ribbon tile.

## Build

```bash
node scripts/oshal-app.js build trading --framework <oshal-checkout>
node scripts/oshal-app.js validate trading
```
