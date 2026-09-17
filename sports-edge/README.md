# Sports Edge

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
tests/                      126 guards, plain node --test
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

# all guards
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

## Fantasy (0.2.0)

Point it at your ESPN Fantasy league and it sets the best legal lineup you could have started, then
records what it advised so the advice can be graded.

### ESPN publishes projections as STATS, not as points

This is the fact the whole fantasy half is built around. Measured on the live feed 2026-09-08:

| | |
|---|---|
| public player feed | 11,617 players, ~39 MB, **no credential** |
| weekly projection rows | 29,281 |
| ...with a usable `appliedTotal` | **zero** |
| raw projected stats | **fully populated** — Kelce week 1: 43.18 rec yds, 0.22 rec TD, 4.0 rec |

`appliedTotal` is null because a fantasy point total does not exist without a league's scoring
rules — half a point per reception or one, four points for a passing touchdown or six. So points are
computed here from your league's own `scoringItems`, which means **this package holds no hardcoded
stat dictionary**. A built-in table would silently mis-score every player in any non-standard
league and look completely normal doing it; your league's settings cannot.

**The `x-fantasy-filter` header is REQUIRED, and its `limit` is ignored.** Both halves matter, and
getting it half-right cost a bug:

| request | players returned |
|---|---|
| no `x-fantasy-filter` | **50** — ESPN's default page, alphabetically early |
| with the header | **11,617**, whatever limit is asked for |

Without the header a roster comes back almost entirely unprojected, which reads as missing data
rather than as a truncated request. The limit is set high anyway so a future ESPN that starts
honouring it cannot silently truncate us. Of those 11,617, about 1,617 carry weekly projections at
all — the rest are practice-squad and inactive players — and roughly 450 project positive points in
a given week.

That size is why the feed is a cached job, distilled to six fields per player before anything is
stored.

### The credential is not an API key

ESPN publishes **no OAuth for fantasy**. The only credential that exists is a pair of browser
cookies, `SWID` and `espn_s2`, which authenticate your **ESPN account** — not a fantasy scope. There
is no per-app revocation, no scoping, and no expiry you control; signing out of ESPN everywhere is
the only revocation.

They are stored encrypted in the connector broker, resolved per request, used on exactly the
outbound league call, and never logged, returned, cached, or placed anywhere a model can read.

**Everything except your private league needs no credential at all** — the projection feed, and
every team model in the rest of this package.

### What it does

- **Best legal lineup** — slot eligibility respected, filled scarcest-slot-first so a flex opening
  never strands the only eligible kicker, then improved by pairwise swaps.
- **An unavailable player is never started.** A projection is not conditioned on availability, so a
  ruled-out starter carries a great number right up to kickoff. `OUT`, `INJURY_RESERVE`,
  `SUSPENSION` and `BYE` are excluded outright — and priced at **zero**, not at their projection,
  when deciding whether benching them is a gain. Getting that second part wrong silences the tool on
  exactly the swap that costs the most; it was caught by a guard rather than in a lineup.
- **Start/sit calls, registered before kickoff** and graded afterwards against what the benched
  player actually scored under your rules.
- **The ledger keeps the projected gain beside the actual one.** "Claimed +40, delivered +2" and
  "claimed +3, delivered +2" are very different tools, and a win rate alone hides that completely.
- **Each player's completed weeks, accumulated from the same response** (0.9.0). The feed a refresh
  already fetches carries every finished week's ACTUAL stat line beside the projections — measured
  live 2026-09-16, one credential-free request for `scoringPeriodId=3` returned 11,617 players and
  1,740 week-1 rows, 1,348 of them with stats. Those weeks are stored raw (never as points: a point
  total does not exist until a league's rules are applied, and the table is shared by every league on
  the box) and scored per league when a lineup is built, so a player's spread is measured from his
  own scores and shrunk toward the positional prior rather than being that prior times his
  projection. Without it two backs projected at 13.2 and 13.1 came out at spreads of 7.26 and 7.21
  and the win-probability objective had nothing to trade — which is exactly what the first live run
  produced: posture underdog, 40.4% to win, and zero variance swaps. The prior season rides in the
  same response (22,243 rows on that run), so the season filter is not optional.

### Routes

| route | what it does |
|---|---|
| `GET /fantasy/status` | connected? linked leagues? (never returns `espn_s2`) |
| `POST /fantasy/link` | link a league; your team is found from your SWID |
| `DELETE /fantasy/leagues/:season/:leagueId` | unlink |
| `GET /fantasy/lineup?season=&leagueId=&week=` | optimal lineup + start/sit, registered on the way out |
| `GET /fantasy/record` | the graded record and the ledger |
| `POST /fantasy/grade` | grade completed weeks |

There is no route that changes your lineup on ESPN. It advises; you set it.

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

The AI Test Lab registers all twelve shipped test suites and the unchanged `package-readiness`
smoke through [tests/test-lab.yaml](tests/test-lab.yaml). The Node suites use packaged source and
synthetic data only. The eleven-case coach unit suite runs the actual compiled refresh, provider client
and store calls with fixture HTTP, World and persistence boundaries; it covers missing/changed
coaches, restart cooldown, team identity, conflicting follows, followed-owner isolation and bounded work. It does not
call live providers, classify news with a model, or place an order. The surface suite parses HTML
and checks route contracts; it is not a browser acceptance test.

Run the package suites with `node --test sports-edge/tests/*.test.js` from the store root, or use
the installed Test Lab's isolated Node runner. Local registration alone does not imply execution,
and the readiness smoke remains separate from these offline assertions.

### Telling an unreachable ESPN from an unconnected account (0.8.0)

Every ESPN read degrades to null rather than throwing, which is right at runtime and used to lose
the one thing the screen needed: WHY nothing came back. A failed read is now classified from what
the client already recorded — `transport` when no HTTP response was produced at all, `unavailable`
when ESPN answered 5xx or 429, `refused` for any other 4xx — and only a refusal is something a
credential can fix. `GET /fantasy/lineup` and `POST /fantasy/link` answer **503** naming the
transport for the first two, and keep the connect-your-account message for the third. The same
distinction runs one layer up: the lineup response says whether the missing opponent is a bye, a
week the schedule does not cover, or a schedule that could not be read, and the matchup card
renders each differently instead of calling all three a bye.

This closed the 2026-09-09 report, where the box's resolver stopped answering, every ESPN read
failed at once, and the app told the operator to paste cookies he had already pasted.
`tests/sports-fantasy-transport.test.js` drives the compiled route with a fetch stub that throws
and asserts both halves; it is offline and needs no framework checkout.

Phase 1 odds maker, complete and proven against live data. Fantasy (0.2.0) is built and its models
are guarded, but its private-league path has NOT been exercised end to end against a real league
yet — the first real test is the operator pasting his cookies, and until then the league reads are
built to the observed contract rather than proven on it. Not built, deliberately: any order path,
any route that changes a lineup on ESPN, alerting into Jarvis, and leagues beyond NFL and NBA.
