# Fantasy Football

0.2.1 adds the company audience view (ADR-164 D6): the Business shells (Studio, Orbit and Commons) open this package's first surface, `GET /api/fantasy-football/`, with `?audience=company`; the shared kit paints a card from the package's own home-summary (read-only, owner-scoped) with the cockpit escape and an in-frame link to the full page, refusals said and never filled in; without the audience the page runs unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`.

Manage the fantasy football team you actually have. Point it at your ESPN league and it sets the
lineup with the best chance of beating the team you play this week, shows what the safest lineup
would have won instead, and records what it advised so the advice can be graded.

It is its own package (ADR-146 D1, operator decisions 2026-09-27) and is bundled with
[`sports-edge`](../sports-edge/) by the application group [`intelligent-sports`](../intelligent-sports/).
The management engine moved here from sports-edge's Fantasy tab in 0.1.0; sports-edge's old
`/fantasy/*` routes now answer 410 with this app's address.

## Your team is yours alone

The operator's rule (ADR-146 Q2): *"the table and connection should be user based.. only i can
control my team.. no one else can see my team and connection."* So:

- **Every table is keyed to the signed-in user under FORCED exact-owner row-level security**
  (`migrations/001-fantasy-football.sql`): a row is visible or writable only when the request's
  identity is its owner. There is **no operator arm** — an operator's session sees none of another
  person's leagues, calls or cached feed. FORCE matters because the api owns these tables, and
  PostgreSQL exempts an owner from its own policies unless the table is forced. The migration reads
  the catalog back and fails if any table is left unforced or without its policy.
- **The ESPN connection spent is the caller's own.** The kernel's default connection pick prefers a
  household-shared connection over a personal one; a shared ESPN connection is somebody else's account
  session, so this package names the caller's personal row by id and refuses the rest. With only a
  shared one available the app says so and asks you to connect your own.
- **You see only the team your own ESPN account owns** in a league.
- **Even the public projection feed is cached per person.** It is the same for everybody, but a shared
  cache would be a table one person's refresh writes and another person's lineup reads. Concurrent
  fetches are still collapsed into one in-process request.

Proved on a real database, not assumed: `tests/fantasy-isolation.spec.ts` starts a disposable
PostgreSQL, applies this package's migration as a NOSUPERUSER NOBYPASSRLS role that therefore owns
the tables (the production shape), mounts the real routes over loopback HTTP on the real kernel
connection lookup and token broker, and proves a second user, an operator and a household member
reach none of the first user's rows or cookies.

## ESPN publishes projections as STATS, not as points

This is the fact the whole engine is built around. Measured on the live feed 2026-09-08:

| | |
|---|---|
| public player feed | 11,617 players, ~39 MB, **no credential** |
| weekly projection rows | 29,281 |
| ...with a usable `appliedTotal` | **zero** |
| raw projected stats | **fully populated** |

`appliedTotal` is null because a fantasy point total does not exist without a league's scoring
rules. So points are computed here from your league's own `scoringItems`, and **this package holds
no hardcoded stat dictionary**. A built-in table would silently mis-score every player in any
non-standard league and look completely normal doing it.

The ESPN reads themselves — league settings, rosters, the schedule and the public player feed,
including the `x-fantasy-filter` header without which ESPN returns a 50-player page — belong to the
`fantasy-leagues` kernel skill (ADR-146 D2). This package declares `uses: fantasy-leagues` and calls
it; `tests/fantasy-skill.test.js` fails if any module here names the fantasy host, builds the cookie
header or sends the feed filter itself.

## The credential is not an API key

ESPN publishes **no OAuth for fantasy**. The only credential that exists is a pair of browser
cookies, `SWID` and `espn_s2`, which authenticate your **ESPN account** — not a fantasy scope. There
is no per-app revocation and no expiry you control; signing out of ESPN everywhere is the only
revocation. They are stored encrypted in the connector broker, resolved per request, handed to the
skill's reads (which put them on exactly the outbound league request), and never logged, returned,
cached, or placed anywhere a model can read. The page never asks for them itself — pasting happens
on the connectors page.

## What it does

- **The lineup with the best chance of winning THIS week.** A week is head-to-head, so the target is
  `P(win) = Φ((μ_you − μ_opp)/√(σ²_you + σ²_opp))`, not the highest projected total: an underdog is
  moved toward variance and a favourite away from it. The highest-projected lineup is always returned
  beside it with its own win probability, and every swap shows what it cost in points and bought in
  win probability.
- **An exact weekly optimiser.** The best legal lineup is a maximum-weight assignment of players to
  slot openings, solved exactly (Hungarian method; fill every opening the roster legally can, then
  maximise points). The greedy-by-scarcity optimiser that moved here from sports-edge lost points to
  brute force on 6 of 3,000 random rosters — up to 21 — whenever a dual-position player met two
  flexible slots; `tests/fantasy-optimiser.test.js` now compares against exhaustive search on 3,000
  seeded rosters and pins the smallest failing case.
- **An unavailable player is never started**, and is priced at zero, not at his projection, when
  deciding whether benching him is a gain.
- **Spreads get real data.** Each player's completed weeks ride along in the feed the refresh already
  fetches; they are stored raw (never as points) and scored under your league's rules as the sample
  each player's spread shrinks toward, so two backs projected 13.2 and 13.1 stop looking equally
  volatile.
- **Start/sit calls are registered before kickoff** and graded afterwards against what the benched
  player actually scored, and the ledger keeps the projected gain beside the actual one.
- **An unreachable ESPN is not an unconnected account.** A read that never reached ESPN answers 503
  naming the transport; only a refusal keeps the connect-your-account message. A bye, an unscheduled
  week and an unreadable schedule are told apart on the matchup card.

Nothing is ever submitted: there is no route that changes a lineup on ESPN.

## The rest of the season (0.2.0)

A roster decision is not "who is the better player", it is **the change in the points your starting
lineup will actually score over the weeks that remain** — "build from the team out", in the
operator's words:

```
L(R, w)   = the best legal starting lineup R fields in week w        (the exact optimiser)
SV(R, W)  = Σ_{w ∈ W} ω_w · L(R, w)                                  (playoff weeks weigh ω = 1.5 by default)
MV(c | R) = SV(R + c) − SV(R)         Δ(c, d) = SV(R − d + c) − SV(R)
```

Bye collisions, handcuffs, depth and scarcity price themselves: a third running back is worth exactly
the weeks he would start. `tests/fantasy-season.test.js` checks SV against the weighted sum of
exhaustive weekly optima on 400 seeded rosters.

**Where each week's numbers come from is stated, not hidden.** ESPN's feed carries a projection for
every week 1-18 (checked on a captured response 2026-09-28; a bye week is a projection row with no
stats), but the `fantasy-leagues` skill distils one week per ~39MB read. So a remaining week is priced
from its own feed when the caller's cache holds it, and otherwise from this week's projection used as
a per-week rate (for a player on a bye this week, the nearest other week read). Bye weeks come from a
hand-typed league's bye table; an ESPN league's byes are not read by the skill. Every response lists
which weeks came from which, and whether byes were known.

- **Waiver board** (`GET /waivers`) — the wire (the feed minus every rostered player) ranked by
  Δ over the best drop, each row with its drop and a FAAB bid `B × Δ / (Δ + E_rest)`, where `E_rest` is
  the value left on the wire besides this claim. A 25% scarcity premium applies when the claim takes
  a slot whose starter is at or below this league's replacement level in more than a third of the
  weeks — the leftover-running-back case. A hard cap keeps $1 per remaining week in reserve.
  Defences, kickers and (in a superflex league) a second quarterback are priced in a separate
  one-week streaming lane that never spends the rest-of-season budget. A rolling-priority league
  gets the ranking and the drop, and no invented bid.
- **Trade finder** (`GET /trades`) — 1-for-1 and 2-for-1 against every other roster, among each
  side's most valuable players, starters or not (a surplus bench player is exactly what the other
  side is short of). Both sides are valued with SV over their own rosters, and a side left over its
  roster size cuts its own least-costly player first. **A proposal surfaces only when both managers
  gain**, and both gains are shown. The guard re-derives the other side's gain for every surfaced
  proposal over 150 seeded leagues.
- **Season value** (`GET /season`) — SV for your roster, week by week, the drop candidate, and the
  league's replacement level by position (the league's own shape: teams × starting slots, flex
  openings to the best remaining eligible players, then the mean of the next three).

All three read the league's shape (whether it bids, the budget left, the last week, the first playoff
week) from ESPN in a request of its own. When that read fails, the board is refused rather than
priced on a guess: 503 naming ESPN when it was unreachable or failing, 502 naming the unread shape
otherwise. An unread shape is never shown as a rolling-priority league or a 17-week season.

## Leagues typed in by hand (0.2.0)

**Manual entry is a first-class input, not a fallback** (ADR-146 Amendment A). A league can be typed
in once and used without any ESPN connection. The league is: a scoring map of ESPN stat id to points (the same keys the projections
carry — nothing here assumes what a stat means), the starting slots, every team's roster and starters
by ESPN player id, the schedule, pro-team bye weeks, the FAAB budget, and the season's shape. The
lineup, the season value, the waiver board, the trade finder and the week ledger all run on it
(`?manualId=`), and **the connector is never consulted on that path**:
`tests/fantasy-manual.test.js` fails if the connection lookup or the broker is called, or if any
ESPN request other than the two public reads (current week, player feed) is made.

## The week ledger (0.2.0)

When a lineup is served, the week's decision is recorded (`ff_weeks`) before kickoff. The record holds the lineup advised, the
highest-projected lineup, the win probability each claimed, the swaps that made them differ, and the
lineup set at that moment. A variance-swap week is then provable from the ledger rather than from a
screenshot. Once a week is complete — strictly before the current week, and with that week's actual
lines already in the caller's store — it is graded from those stored actuals under the league's own
rules: the advised lineup's actual points against the lineup **actually started** (ESPN's lineup for
that week, read with the caller's own credential, or the recorded one for a hand-typed league). The week's
start/sit calls are settled first, and a week never closes with an ungraded call. Grading runs in the
caller's own requests (the lineup grades what is due before it builds, and `POST /grade`), never as a
cross-user pass.

Found on the way, by the real-database proof: the start/sit grading statement moved from
sports-edge (`actual_gain = $3 - $4`) is refused by PostgreSQL with
`operator is not unique: unknown - unknown`. It had never run against a real server. Both grading
statements now type their parameters, and `tests/fantasy-isolation.spec.ts` grades a week on a
disposable PostgreSQL.

## Routes

Under `/api/fantasy-football`, every one `oidc`-authenticated and self-gated on the caller. A board
request naming no league reads the caller's most recently linked ESPN league.

| route | what it does |
|---|---|
| `GET /` | the surface |
| `GET /status` | connected (with your own connection)? your linked leagues? never returns `espn_s2` |
| `POST /link` | link a league; your team is found from your SWID |
| `DELETE /leagues/:season/:leagueId` | unlink one of your leagues |
| `GET /lineup?season=&leagueId=\|manualId=&week=` | the P(win) lineup + start/sit; records the week and its calls before kickoff |
| `GET /season?leagueId=\|manualId=` | rest-of-season value, the drop candidate, replacement levels |
| `GET /waivers?leagueId=\|manualId=` | the waiver board (bid and drop per row) and the streaming lane |
| `GET /trades?leagueId=\|manualId=` | trades both managers gain from, both gains shown |
| `GET`/`POST /manual-leagues`, `GET`/`PUT`/`DELETE /manual-leagues/:id` | your hand-typed leagues |
| `GET /record` | your start/sit record, the call ledger and the week ledger |
| `POST /grade` | grade your own completed weeks from stored actuals |
| `GET /home-summary` | your Home tiles (owner-scoped SELECTs only) |
| `GET /_smoke` | service-authenticated package readiness (metadata only) |

## Build & test

```bash
# from a framework checkout — compiles src-routes/*.ts -> routes/*.js (@/ imports preserved)
node scripts/oshal-app.js build <this dir> --framework .
node scripts/oshal-app.js validate <this dir>

# the plain-node suites; the ESPN client is the fantasy-leagues kernel skill, compiled from a
# framework checkout's source (OSHAL_CORE_ROOT, OSHAL_CORE_DIR or OSHAL_FRAMEWORK)
cd <this dir> && OSHAL_CORE_DIR=<framework checkout> node --test "tests/*-*.test.js"

# cross-user denial on a disposable PostgreSQL (Docker required; never a deployment database)
cd <this dir> && OSHAL_CORE_DIR=<framework checkout> node --test tests/isolation.core.test.js
```

All suites are registered with the AI Test Lab in [tests/test-lab.yaml](tests/test-lab.yaml).

## Status

0.1.0 moved the management engine from sports-edge (0.2.0 to 0.10.0 there), re-keyed it for per-person
ownership, and made the optimiser exact. 0.2.0 adds the rest-of-season value, the waiver board, the
trade finder, hand-typed leagues and the week ledger. **Not yet exercised against a real league in
this package:** the operator's private league was read through sports-edge on 2026-09-09 and
2026-09-25, but this package has not been installed on the box, and a league linked in sports-edge
must be linked once more here. Once it is, the Test Lab PAT smokes `own-lineup`,
`own-season-value`, `own-waiver-board` and `own-trade-finder` read the caller's own real league
from the installed package; `own-lineup` also registers that week in the caller's own ledger. Open work is in [BACKLOG.md](BACKLOG.md).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
