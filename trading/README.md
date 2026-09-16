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
  account's concerns: KPI strip; **Buy a stock**; open positions; **Allocation** and **Exits**
  (1.11.0, below); the focus pane (chart, signal model, order ticket — opens when you click a
  position); and the account's own Trade journal + Performance sub-tabs. The header shows the account's strategy line with an inline **Set** /
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

### Positions the engine will not trade (1.15.0, ADR-159)

The engine reads the **venue's** positions and manages what it finds there, so a share bought by
hand outside it used to acquire an engine decision measured against a cost the engine never paid.
Since ADR-159 (`docs/adr/159-the-engine-manages-only-what-it-can-account-for.md` in the framework
repo) it withholds instead: a holding its own filled orders cannot account for gets **no order at all** — no
stop, no take-profit, no trailing exit, no rotation or rebalance trim, and no entry that adds to it.
A `TRADING_CORE_SYMBOLS` ring-fence withholds for its own, separate reason.

Both were invisible until 1.15.0: a position could sit with no stop and no exit and look exactly
like one under full management. The positions table, the holdings list, the focus pane and the Exits
card now badge every such row, and say what the badge means under the table:

| badge | what the engine does | what changes it |
|---|---|---|
| **not managed** | no order of any kind — its own filled orders do not cover the quantity held | account for the shares (partial coverage is not coverage) |
| **ring-fenced** | `SYM:0` in `TRADING_CORE_SYMBOLS`: held, never bought, never sold | the environment variable — this one is a setting, not a finding |
| **core hold N%** | no sleeve exit, but the beta core still tops it up and trims it toward N% | the environment variable |
| **not known** | not stated — the engine's own answer for this book could not be read | reload; the order ledger or the protected-lot ledger is unreadable |
| **protected lots** | nothing at all — every share is pinned, so the autopilot never sees the position; each lot works the exits it was opened with | release the lots — a setting, not a finding |

A **marked position is still monitored**: it shows in every list, its market value still counts
toward exposure, capital and drawdown, and its P&L is shown on the venue's basis. Only the orders
are withheld.

**Which quantity the badge is about.** The row prints what the venue reports; the engine's answer is
about the shares the autopilot can act on, and protected lots make those two different numbers. Each
`/ledger` answer therefore carries both — `heldQty` (the row) and `governedQty` (what the autopilot
sees, `0` when the whole position is pinned) — and the explanation under the table opens by saying
which is which, so a row reading 400 beside a sentence about 250 is not left for the reader to
reconcile. A holding pinned in FULL is dropped from the autopilot's view before anything can govern
it, so it reads **protected lots** rather than *not known*: somebody did look, and the answer is
benign.

The answer is the **kernel's**, carried on `GET /ledger` as `governance` (`{SYM: {exitsApply,
ordersApply, reasons[], heldQty, governedQty}}`) and on each `GET /exposure` exit-rule row. The surface never decides
"can the engine account for this?" — that has one definition and it lives with the order paths that
enforce it. A symbol the payload does not answer for reads **not known**, never *managed*: the
surface must not turn "could not look" into "looked and found nothing".

### Allocation and Exits on the account page (1.11.0)

Two cards sit between the positions table and the protected lots, both filled by one
`GET /api/trading/exposure` read. Neither auto-refreshes — the read costs a broker
account + positions + orders round trip.

**Allocation** is the account's asset-kind and sector mix.

- *Sectors are the engine's own.* The buckets come from the kernel's `sectorOf()` map — the same
  map the **per-sector sizing cap** enforces — so the mix you read is the mix the engine sizes
  against. This package defines no sector taxonomy of its own, and the surface never guesses one:
  a held name the engine does not classify is grouped under **other**, called out in red in the
  card's footnote, and shown with no cap headroom. (A card that invented a sector for a real
  portfolio would be worse than no card.)
- *Stock vs ETF comes from Alpaca.* The kind column is the Alpaca US-equity asset directory
  (`etp` attribute). That is Alpaca's answer even for a Schwab book, and it is **not** venue data.
  Without the Alpaca paper keys the directory is empty, and those shares read **kind unknown**
  rather than being defaulted to "stock".
- *Headroom is the engine's rule, not a lookalike.* Per sector: `maxSectorPct% × equity − what
  that sector already holds`, over the **protected-lot-subtracted** positions, exactly as
  `sizeEntry` computes `sectorRoom` — including its equity-or-cash fallback, so a cash-only book
  reads the headroom the engine would actually size against rather than zero. On a capped live book
  the cap is measured against the capped equity the engine sizes from (`capAccount`), and the
  footnote says so; percent-of-equity columns stay on the account's real equity. A sector the operator has leaned (`TRADING_SECTOR_TILT`)
  carries a `tilt ×N` pill. Protected shares are shown as `pinned N` on the name, never folded
  into the sector's value.
- The footnote also reports how many of the engine's universe names the sector map classifies —
  generated from the running engine, not typed here.

**Exits** answers "what is protecting this account right now", in two clearly separated sections.

- **Working at the venue** comes first, and it is the venue's own order record (`listOrders` over
  the last `TRADING_EXPOSURE_ORDERS_DAYS`, filtered to the kernel's non-terminal statuses): these
  orders are actually resting at the broker. Origin is claimed only where the order proves it —
  an exit order id the protected-lot ledger recorded, or the kernel's `lot-` request-id
  convention; everything else reads **unattributed** rather than being attributed by guess. If the
  broker order read fails the section says the list is **unknown, not empty** — an empty table
  here would read as "nothing is protecting this account", which is a different and dangerous claim.
- **Autopilot exit rules** comes second and is labelled as rules. Each held name's stop,
  take-profit, trailing stop (armed/not, priced off the peak **rolled forward the way the engine
  rolls it** — `nextPeaks(positions, storedPeaks)`, what `computeExits` computes before it evaluates
  a trailing stop, so a winner at a new high is not priced off a stale high) and cap trim are
  computed by
  calling the engine's own `exitsToRun` / `trailingExits` / `rebalanceTrims` on that position, so
  the panel cannot disagree with the engine's arithmetic; a row whose rule would fire on this
  snapshot carries the engine's own reason. The **cap trim** is measured against the capped
  **equity** — what the dispatch hands `rebalanceTrims` — deliberately not against the sector
  denominator above: `sizeEntry`'s equity-or-cash fallback is that rule's own, and reusing it here
  would trim a zero-equity book on a base the engine never trims on. These are **not** orders resting at the venue —
  nothing here protects the position while the engine is not running. Two exemptions are rendered
  explicitly rather than hidden: a `TRADING_CORE_SYMBOLS` **core hold** (the dispatch filters every
  exit for a core symbol, so a stop shown on one would never fire), and any non-regular session —
  off-hours the engine runs **only** the close-anchored dip rule, so the whole block is marked not
  in force, as it is under `TRADING_HALT` and when the venue clock is unreachable.

`GET /api/trading/exposure?book=<ref>` — book-scoped (query-first, `?mode=` still aliases),
`callerSub` 401-gated, 503 `broker_not_configured` when that book's broker is not connected, 502 on
a failed account/positions read (an empty book and a failed read must never look alike). Read-only:
it places no order, constructs no order-placing adapter, and does not persist the trailing peaks it
reads. Answers `basis`, `policy`, `engine` (session, whether the rules run now, core holds, the
engine's universe size and how much of it the sector map classifies), `sources`, `mix`, `exits`
`{ working, rules }` and a `sections` map naming any side read that came back unavailable.

*A degraded read is said, never painted as fact.* Six side reads can fail independently, and each
one costs the cards something different, so the cards repeat the `sections` map instead of quietly
rendering the fallback: a red **Degraded** line names what could not be read **and what that costs
the figures below** (a section the payload gains later is surfaced by both cards rather than dropped
by both). One case is stronger than a warning — **a failed protected-lot read withholds the exit
rules table entirely.** Its fallback is a no-op subtraction, so every stop, take-profit and trim
would be drawn over shares the autopilot may be forbidden to sell, under a foot claiming they were
excluded; the engine's own answer to that read failing is to skip the fire, and the card's is to
show no rules. **The payload withholds them too** — `exits.rules` comes back `null`, not a computed
list — so a non-browser consumer that reads `rules` without checking `sections` cannot be handed
stops drawn over ring-fenced shares either. (`null` is the shape `exits.working` already uses for a
venue read that failed: unknown, not empty.) A failed peaks read is also called out where the
trailing prices are, because they are then anchored at average cost rather than at the position's
real high.

New env, both with safe defaults: `TRADING_EXPOSURE_ORDERS_DAYS` (venue order lookback, default 90)
and `TRADING_EXPOSURE_WORKING_MAX` (row ceiling, default 200).

### The advisor scans the engine's universe, not a copy of it (1.11.0)

Arming the advisor (`POST /api/trading/autopilot`) used to write the engine's `DEFAULT_UNIVERSE`
into every leg's `taskData`. That froze a copy of the list at the moment of arming: a swarm armed
months ago kept scanning the names as they stood that day and never saw a universe expansion.
It no longer does. `taskData` carries `universe` **only when the operator pinned one** — and the
dispatch, research and assess legs each fall through to the engine's `DEFAULT_UNIVERSE` when the key
is absent, so an un-pinned advisor tracks the engine on every fire.

- `GET /api/trading/autopilot` reports `universeSource` (`default` | `pinned`), `universeCount` (what
  this schedule will actually scan) and `defaultUniverseCount` (how big the engine's list is now), so
  the difference is read rather than inferred.
- A pinned list is deduplicated and upper-cased. Over the ceiling it is **refused with HTTP 400**
  (`universe_too_large`, and nothing is scheduled) rather than silently truncated — the old code cut
  a longer list at a literal 150 and never told the operator which names it dropped.
- New env: `TRADING_UNIVERSE_MAX_PIN`, the pin ceiling. Its default is the engine's own universe
  size, so the ceiling tracks the engine instead of a number typed here.

**An advisor already armed keeps whatever it was armed with.** The pin lives in the stored schedule
row; it changes on the operator's next deliberate disable/enable, not on deploy. Do not re-POST the
autopilot as part of shipping this — re-arming is the operator's own action.

### Surface posture under strict CSP (1.10.3, ADR-136 D2 tail)

The surface carries no inline `<script>` blocks, no inline event-handler attributes and no
`javascript:` URLs, `eval`, `new Function` or string timers, and it installs no handler as a
string at runtime (`setAttribute('onclick', ...)`, `el.onclick = '...'`). Every action is a
delegated listener on the view's own host (`#acctCtxBar`, `#acctHead`, `#rosterHost`,
`#labApplied`, `#discoverBtn`) keyed on `data-act`: only ids ride the markup, and every label,
book id and trading-state flag is resolved from `BOOKS`/`BOOK` at click time — so a row painted
before a state change can no longer send a stale flag. It is written against the kernel's strict
policy: `script-src 'self'` with no `unsafe-inline`, while `style-src` keeps `unsafe-inline`,
which is what the surface's inline `<style>` block and `style=""` attributes rely on.

Every `async load*` in `tools/ui` captures the render token — and, for sub-tab loaders, the
sub-tab generation stamped on `#tabbody` — before its first `await` and bails after it, before
it paints. A slow answer for the account or sub-tab you just left can no longer paint over the
one you chose.

Guards: `tests/trading-html-syntax.spec.ts` (no inline block, no handler attribute in either
spelling, no string-installed handler, the pinned set of external scripts the shell loads, and
the kernel policy read from `strict-csp` rather than described) and
`tests/trading-ui-loader-guards.spec.ts` (every loader discovered from source, classified, and
proven to capture before its first await and bail before it paints).

Note on posture, because it is easy to get backwards: `OSHAL_STRICT_CSP=on` selects enforce, but
`OSHAL_CSP_REPORT_ONLY=on` overrides it, and `OSHAL_CSP=off` overrides both. A deployment that
sets the first two serves a `Content-Security-Policy-Report-Only:` header — so confirming
behaviour under enforcement means unsetting the report-only pin and checking the header name
changed, not setting an enforce flag that is already on.

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

**When** (1.9.2, minute precision in 1.10.1, ADR-136 D4): step 2 also asks *Now* or *At a time (ET)*.
A timed order is minted now but placed later by the trading leg at the chosen Eastern time — a trading
day that is not an exchange holiday (the server refuses one **by name**), at **its own minute**
anywhere in **7:00 AM–7:59 PM ET**, within the server's horizon (`TRADING_DATED_MAX_DAYS`). The 1.9.2
5-minute grid is gone: the leg now ticks every minute, so 9:37 means 9:37 (within the scheduler's
15-second poll). Outside the regular session (9:30 AM–4:00 PM) the venues take only a **limit** rule
marked **eligible for extended hours** as a **day** order, and the ticket says so before you send it —
a pre/post-market market order is refused, not quietly retyped. That extended-hours dated order places
whatever `TRADING_EXTENDED_HOURS` is set to: that flag gates the autopilot's own extended-hours
behaviour and its market→limit conversion, not an order you scheduled yourself. There is no Place step:
the review is the commitment, so a live account confirms *before* the mint. The account page's **Timed
orders** card lists pending ones with Cancel; once fired the order is an ordinary Trade-journal entry.
A window missed by more than the grace (`TRADING_DATED_LATE_MINUTES`) expires unfired rather than
placing a stale order. Protection rules may ride along; the lot's unfilled-entry release then counts
from the fire time. The accepted window is *derived from the leg's own cron* (`TRADING_EVENTS_CRON`) —
widen the cron and the window widens with it; there is no second setting to keep in step.

Direct trades do **not** follow the account's strategy — there is no signal generation involved —
but they pass through the identical guardrails, live gate, submission-reservation arbiter, and
disabled-book refusal as every strategy-originated order; there is one order path, not two.


**Cash accounts and settlement** (1.10.0, ADR-134 D8): a cash account (the IRA) settles sales T+n
business days later (`TRADING_SETTLEMENT_DAYS`, default 1). On such an account the ticket shows
*Settled to spend* and sizes a percent order against settled cash; a buy that would be funded by
unsettled sale proceeds is refused before the confirm step (422 `settlement_blocked`, naming the day
the proceeds settle) — or, when that account is set to *warn only*, allowed with a warning. Selling a
stock that was bought while proceeds were still unsettled shows a good-faith-violation advisory, never
a block. Margin accounts and paper are unchanged. The fleet default is
`TRADING_CASH_SETTLEMENT_POLICY` (refuse | warn | off) and each cash account's header carries an
*Unsettled buys* control (server default / refuse / warn only) — only the server env can turn the
guard off. The engine re-checks at execution, so the autopilot meets the same wall.

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


### API added in 1.10.0 (cash settlement, ADR-134 D8)

- `GET /api/trading/account` also answers `settlement` — `{ accountType, policy, cash, settledCash,
  unsettledCash, settlesOn { iso, words }, source, settlementDays }`.
- `POST /api/trading/decisions/manual` answers 422 `settlement_blocked` `{ message, settlesOn,
  settlement }` for a buy funded by unsettled proceeds under *refuse*; it carries `settlement` and may
  carry `warning` (a settlement warning, the good-faith advisory, or the scheduler warning — merged
  with " · ").
- `GET /api/trading/accounts` — each entry in `books[]` carries `accountType` and `settlementPolicy`.
- `PATCH /api/trading/accounts/books/:bookId` accepts `settlementPolicy`: `'refuse'` | `'warn'` |
  `null` (400 `settlement_policy_invalid` otherwise).

### API changed in 1.10.1 (timed orders at minute precision, ADR-136 D4 follow-up)

- `POST /api/trading/decisions/manual` — `fireAtEt.time` is now accepted at **any minute** from
  `07:00` to `19:59` ET (the 5-minute grid is gone). The route passes the order shape to the kernel's
  `validateFireAt`/`createDatedOrder`, which is what makes a pre/post-market time possible at all: the
  kernel **fails closed** without it, so a caller that omits `orderType`/`extendedHours`/`timeInForce`
  gets 400 `fire_at_invalid` for every time outside 9:30–4:00.
- 400 `fire_at_invalid` now also names an **exchange holiday** ("The market is closed on Mon Sep 7,
  2026 (Labor Day).") and states the pre/post rule verbatim when a non-conforming order is scheduled
  outside the regular session.
- Scheduling a protected or timed order **re-creates** a `trading-events` leg still on a retired
  cron/timezone (create-or-replace keeps its id, status and execution count), so an existing user
  migrates onto the every-minute cadence without re-arming anything.
- New refusal path for an existing user: because a stale-but-active leg no longer short-circuits, a
  **timed** order now runs that create-or-replace before anything is written — so a scheduler that is
  absent answers 503 `scheduler_unavailable` and a create that fails answers 502, where 1.10.0 would
  have accepted the order onto the retired cadence. Refusing is the honest answer: nothing is at the
  venue yet, and a timed order with no leg would never fire. (A **protected** order is unchanged — its
  leg is armed best-effort *after* the order, and a scheduler failure there is a warning, never a
  refusal, because that order has already gone to the venue.)

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
