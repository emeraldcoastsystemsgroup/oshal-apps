# Sports Edge

0.11.1 adds the company audience view with its family alias (ADR-164 D6): Studio, Orbit and Commons open this package's first surface, `GET /api/sports-edge/review`, with `?audience=company`, and Jarvis with `?audience=family`; the shared kit paints the followed teams and the upcoming games with a cached preview from the package's own home-summary, refusals said and never filled in; without the audience the page runs unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`.

Follow a team. Really know its next game. Call it straight up or against the line.

This is not a slate scanner. The unit of work is one game involving one team you chose, built from
the ground up: both teams' season tape, both injury reports weighted by what those players actually
produce, the unit matchup, rest and travel, and the wire — folded into a line, and then measured
against the book's number.

---

## Read this before you use it

Phase 1 **stakes nothing**, and that is a decision backed by evidence from this platform's own
ledger rather than caution for its own sake.

Before this package was designed, the live `kalshi_predictions` table on the operator's box was
queried:

```
             settled   our Brier   market Brier   we beat the market on
  all series    2507      0.1814        0.1400        762 / 2507  (30%)
```

Every series loses, including ones with 185 settled rows. That is the same "run every algorithm and
bet it" thesis, in the same asset class, with a 2,507-sample record of being **worse than simply
paying the price**. The conclusion is not that sport cannot be modelled — it is that a model earns
the right to stake by beating the closing line first, on rows anyone can audit.

So this package:

- registers every call **before kickoff**, with the price at pick time, and grades it at settlement
- scores itself on **closing-line value first**, Brier second, and win-loss last
- carries **no order path at all** — there is nothing to click that spends money
- records the free baselines it must beat (the market's own line, and ESPN's matchup predictor) as
  shadow strategies from the very first game

When and if it earns a `PROVEN` verdict, the rail is Kalshi — the CFTC-regulated event-contract
exchange this platform already connects to, with its confirm-gated, `KALSHI_LIVE_ENABLED` order
path. **There is no sportsbook automation here and there will not be**: no US retail book offers a
betting API, and every one of them forbids automated placement in its terms.

---

## How good is the model, actually?

Measured, not asserted. Walk-forward over completed seasons — for each game the models are fit
**only** on games that finished before it, so nothing is in-sample:

| | games scored | straight-up | always-home baseline | Brier | mean margin error |
|---|---|---|---|---|---|
| NFL 2025 | 223 | **62.3%** | 52.9% | 0.2274 | 10.48 pts |
| NBA 2025 | 1081 | **66.2%** | 54.3% | 0.2121 | 11.18 pts |
| NCAAF 2025 | 638 | **72.6%** | 58.6% | **0.1823** | 12.95 pts |

Face validity checks out: the top-rated 2025 teams come out SEA (NFL), OKC (NBA), and Texas Tech /
Indiana / Ohio State / Georgia (NCAAF).

**College football scores best of the three, and that is not the same as having the most edge.** Its
talent gaps are enormous, so many games are genuinely easy to call — which is exactly why the
always-home baseline is also highest at 58.6%, and why books close college around 75-77% straight
up. Predicting winners is not the bar; beating the closing line is.

The margin error independently checks the dispersion constant: for a normal distribution
MAE = 0.798σ, so the NCAAF error of 12.95 implies **σ ≈ 16.2** against the 16.5 the model uses.

**This is materially better than a naive baseline and still short of the market.** Books close
around 66-67% straight up in the NFL and 68-70% in the NBA, with sharper Brier scores than these.
That gap is exactly why the staking gate exists and why it starts closed. Reproduce the numbers
with the walk-forward harness described under [Verifying](#verifying).

---

## How the line is built

Two kinds of model, combined two different ways. Getting this distinction wrong is the most
corrupting possible bug in the package, so it has its own named guard in the test suite.

**Strength models** are competing estimates of *one* quantity — how much better one team is — and
are combined by weighted **average**:

| model | weight | what it is |
|---|---|---|
| `elo` | 0.45 | Margin-of-victory Elo with autocorrelation damping, carried over from last season and regressed toward the mean. Recency-weighted; cares about sequence. |
| `power` | 0.35 | Simple Rating System: average scoring margin plus average opponent rating, solved by iteration. Weights the whole season equally; cares about schedule strength. |
| `units` | 0.20 | Two-sided SRS splitting each team into an offence and a defence, so "their offence against our defence" is a measured quantity. |

**Context adjustments** are separate effects the strength models cannot see, and are **added**:

| adjustment | what it is |
|---|---|
| `availability` | Each injured player's positional leverage, scaled by his real share of team production and by how likely he is to miss. |
| `rest` | Back-to-backs and short weeks, per league. |

A strength model with **no data abstains** rather than voting a zero, and the remaining weights
renormalise. Early in a season that usually means Elo alone carries the line — which is the honest
answer, not a gap.

### Injuries are weighted by production, not by position alone

A generic "a WR is worth 1.5 points" constant treats a team's leading receiver and its fifth wideout
identically. Instead, for every injured player whose position has a meaningful counting stat, the
package fetches that player's season statistics **and his team's totals in the same category**, and
divides. The denominator is real.

Positions with no box-score footprint — offensive line most of all — fall back to positional leverage
alone. An honest "we cannot measure this" beats a plausible invented number.

**What this deliberately does not claim:** true position-versus-position charting, this receiver
against that cornerback snap by snap, needs charting data with no free source. It is absent rather
than faked.

---

## The staking gate

Borrowed from `@/features/prediction-markets` `strategy-scorecard` and made strictly harder for
sport:

```
UNPROVEN — fewer than MIN_GRADED (30) settled calls.              → stake 0
FAILING  — enough evidence, and it fails EITHER bar below.        → stake 0 (auto-retired)
PROVEN   — enough evidence, better Brier than the market, AND     → stake allowed
           positive average closing-line value.
```

**Closing-line value is the first bar, not the third.** A season is a tiny sample: a model making a
hundred NFL calls can finish 55-45 on pure luck and look like edge. Beating the close is the market
itself confirming a pick was mispriced, and it converges in dozens of bets rather than thousands. A
strategy that beats the close and loses money was unlucky; one that loses to the close and makes
money was lucky. Both stay unproven.

A strategy with settled calls but **no closing prices recorded** cannot clear the CLV bar and stays
`FAILING`. The fix is to record closing prices, not to lower the bar.

---

## Data

ESPN's public JSON. No key, no credential, no model in the read loop — every read is a
schema-bounded GET, which is the ADR-036 boundary in its simplest form. Verified live on 2026-09-06:

- team list, and rosters with position, age, experience and injury flags
- full season schedules with final scores and neutral-site flags
- the scoreboard, carrying DraftKings' moneyline, spread and total **inline**
- game summaries: per-player injury reports with status and body part, ESPN's own matchup predictor,
  against-the-spread records, last-five form, team leaders, and the news wire
- per-athlete and per-team season statistics

These endpoints are **not a contracted API**. Every accessor is defensive: a missing branch yields an
empty result rather than an exception, so a silent shape change degrades one game card instead of
taking down the poller.

**Reads are retried, and a failed read is never rendered as an answer.** Measured on the live box
2026-09-07: eight consecutive reads from a fresh process in the same container all succeeded in
under 1.6s, while the long-running api intermittently failed the identical read — and the failure
surfaced to the user as *"your team has no games this week"*. A single attempt from a busy event
loop is not a reliable read. So `getJson` retries transient failures (5xx, 429, network errors —
never a 4xx, which will not change), and when every attempt is exhausted it fires `onError`. That
propagates to `/games` as `upstreamOk: false`, and the surface says **"could not reach the schedule
service"** instead of **"no games"**. An empty list is only an answer when the read succeeded.

Season years are keyed the way ESPN keys them, which differs by league and is a genuine trap: the
**NFL season is keyed by the year it starts, the NBA season by the year it ends**.

---

## Layout

```
oshal-app.yaml              manifest — routes, migrations, settings, the cockpit tile
migrations/001-*.sql        followed teams, ratings/preview caches, settings, the ledger
src-routes/
  sports-odds.ts            American odds, two-way de-vig, normal margin model, quarter-Kelly, CLV
  sports-ratings.ts         Elo (MOV + carry-over) and iterative SRS power ratings
  sports-adjustments.ts     production-weighted availability, rest/travel, two-sided unit ratings
  sports-ensemble.ts        the average/add split, shadow models, edge evaluation
  sports-espn.ts            the deterministic read layer
  sports-preview.ts         season ratings assembly + the assembled game preview
  sports-ledger.ts          pre-kickoff registration, settlement grading, the staking gate
  sports-store.ts           Postgres access (schema self-heals)
  sports-refresh.ts         the background loop: ratings, previews, grading
  sports-routes.ts          /api/sports-edge
tools/sports-edge.html      the surface
tests/                      130 guards, plain node --test
```

The first four modules have **no framework imports**, so they load under plain-node tests.

## Routes

| route | what it does |
|---|---|
| `GET /` | the surface |
| `GET /teams?league=` | team picker |
| `GET`/`POST` `/follow`, `DELETE /follow/:league/:team` | the follow list |
| `GET /games` | upcoming games for followed teams, with preview headlines |
| `GET /preview/:eventId?league=&refresh=1` | the full game preview |
| `GET /scorecard` | strategy verdicts |
| `GET /ledger` | registered and graded calls |
| `GET`/`PUT` `/settings` | cadence (operator) and horizon/alerts (per user) |
| `POST /ratings/refresh` | operator-only rating rebuild |

There is no order route. That is the point.

## Build & test

```bash
# from an OSHAL checkout — compiles src-routes/*.ts -> routes/*.js (@/ imports preserved)
node scripts/oshal-app.js build <this dir> --framework .
node scripts/oshal-app.js validate <this dir>

# all guards — dependency-free plain node against the compiled modules
cd <this dir> && node --test "tests/*.test.js"
```

### Verifying

Two checks were run live while this package was written, and both are worth repeating after any
change to the models:

1. **Walk-forward accuracy** — fit the ratings on games 1..k, predict game k+1, across a completed
   season. This is what produced the table above, and it is the only honest read on whether a model
   change helped.
2. **A live end-to-end preview** — build a real preview for a real upcoming game and read the model
   contributions. Both bugs found on 2026-09-06 (carry-over silently discarded; a dataless model
   voting a zero) were invisible to the unit tests and obvious the moment a real preview was printed.
   Each now has a named regression guard.

---

## Fantasy moved to its own app (0.11.0)

The fantasy half — ESPN league link, the win-probability lineup advisor and the start/sit ledger —
is now the [`fantasy-football`](../fantasy-football/) package (ADR-146 D1; operator decisions
2026-09-27), grouped with this one as the application group [`intelligent-sports`](../intelligent-sports/).
It moved to per-person ownership on the way: every table there is keyed to the signed-in user under
forced exact-owner row security, and only the caller's own ESPN connection is spent.

Here, `/api/sports-edge/fantasy/*` answers **410 Gone** with the new app's address
(`src-routes/sports-fantasy-moved.ts`), the Fantasy tab says where it went and links there, and the
Home summary no longer carries fantasy metrics. This package no longer declares the
`fantasy-leagues` skill or the `espn-fantasy` connector: nothing here reads a league any more.
The `sports_fantasy_*` tables (migrations 002 and 005) are left in place, unread and unwritten — a
version bump does not delete a person's rows, and the new package deliberately does not read
another package's tables, so a league linked here is linked once more there. The fantasy suites
moved with the code and still guard it there; `tests/sports-fantasy-moved.test.js` guards the move.

## Status

### Coach coverage and package tests (0.7.1)

For each followed team due for its six-hour World refresh, the public ESPN roster response supplies
the current head coach through its top-level `coach` array. The stored team ID and abbreviation
must match the response; the coach query uses ESPN's team label. Conflicting stored IDs for the
same team omit coach discovery until corrected. An explicit head-coach entry
or a single unlabelled coach is accepted; missing names, assistants alone and ambiguous staff
produce no person subject. A changed coach is picked up on the next team cycle, with the previous
coach's archive retained. Team, injury and coach subjects share the existing World service, feed
set, persistent cooldown and twelve-subject pass budget. No coach read occurs when World is off.

Public provider responses checked on 2026-09-11 confirm this envelope for the
[NFL roster](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/12/roster) and
[NBA roster](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/2/roster).
The earlier backlog assumption that the bare team endpoint contains `coaches` was stale.
College football uses the existing league mapping and the same defensive roster reader; its
public response could not be independently retrieved during this check. Missing or changed
staff data in any league produces no coach subject. These undocumented endpoints are not a
provider schema guarantee, and no coach names are embedded in the implementation or fixtures.

This remains a deployment-wide public news archive. It does not change the ownership of followed
teams, use private ESPN Fantasy cookies, or turn archived news into a model adjustment. That last
step still needs the measurement described in [backlog A](BACKLOG.md#a-the-archived-wires-are-written-but-never-read).

The AI Test Lab registers all ten shipped test suites and the unchanged `package-readiness`
smoke through [tests/test-lab.yaml](tests/test-lab.yaml). The Node suites use packaged source and
synthetic data only. The eleven-case coach unit suite runs the actual compiled refresh, provider client
and store calls with fixture HTTP, World and persistence boundaries; it covers missing/changed
coaches, restart cooldown, team identity, conflicting follows, followed-owner isolation and bounded work. It does not
call live providers, classify news with a model, or place an order. The surface suite parses HTML
and checks route contracts; it is not a browser acceptance test.

Sports Edge 0.9.2 declares `uses: world-data` for its already-shipped shared-World refresh reader.
It is a manifest compatibility floor, not a new feed or order path: a core missing the skill
refuses the package before mount. The public World refresh remains disabled when World is off.

Run the package suites with `node --test sports-edge/tests/*.test.js` from the store root, or use
the installed Test Lab's isolated Node runner. Local registration alone does not imply execution,
and the readiness smoke remains separate from these offline assertions.

Phase 1 odds maker, complete and proven against live data. Not built, deliberately: any order path,
alerting into Jarvis, and leagues beyond NFL and NBA.

Sports Edge 0.9.3 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/review.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| team-news-classification | news item | T1 | none | template | not yet measured | none recorded |
<!-- oshal-rating:end -->
