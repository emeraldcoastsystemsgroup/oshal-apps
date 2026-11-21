# sports-edge — BACKLOG

Open work on the packaged odds maker. Every entry has a done-when so scope does not have to be
guessed later.

**Posture (v0.12.3).** The package ships and runs. It follows a team, builds a line from Elo +
schedule-adjusted power ratings + an offence-versus-defence unit matchup, adjusts for injuries by
each player's real share of production, compares that line to DraftKings' moneyline and spread, and
registers every call before kickoff. Line capture is live and change-only. The fantasy half moved to
its own package, `fantasy-football`, in 0.11.0. There is **no order path**, by design.

What is below is the honest remainder.

---

## A. The archived wires are written but never read — DONE (0.12.3, negative result — unused wire ingest retired)

Walk-forward evaluation against the current ensemble as Control closed this entry with a clean
negative result (`node sports-edge/tests/walk-forward-wire-signal.mjs`, frozen snapshot
`tests/walk-forward-wire-signal-data.json`, guarded by `tests/sports-wire-walk-forward.test.js`):

- **Completed 2025 benchmark seasons:** `0 / 1,942` games (NFL 223, NBA 1,081, NCAAF 638) had
  archived `world_items` because the World archive began `2026-08-18`.
- **Live 2026 archive (`2026-08-18` to `2026-11-20`):** only followed teams were ingested —
  `1/32` NFL (`SEA`), `0/30` NBA, `1` NCAAF (`ARK`) — leaving `0%` opponent coverage while
  spending `2,598` feed pulls, `91,673` fetched items, `14,923` archived items, and `16,581` LLM
  classifications.
- **Strict pre-kickoff walk-forward (Combined 2026 `SEA` + `ARK`, n=20, UTC `[D-7, D-1]`):**
  Control (`0.2417` Brier, `13.85` pts MAE, `70.0%` SU) beat de-biased 7d-vs-30d team sentiment
  delta (`0.2418` Brier, `13.87` MAE, `t=+0.17`), injury-wire 7d volume burst (`0.2537` Brier,
  `14.12` MAE, `65.0%` SU, `t=+1.94`), and their combination (`0.2519` Brier, `14.11` MAE,
  `t=+1.81`). Uncentered raw 7d sentiment worsened MAE (`13.88` combined, `11.88` vs `11.81` NFL)
  with no statistically meaningful Brier lift (`t=-0.94`) and injected a one-sided positive-mean
  bias toward whichever team was followed.

**Action taken in 0.12.3:** recorded the full Control vs Candidate table and reproducible command
in `README.md`, retired unused World wire ingest in `refreshWorld` (`WORLD_WIRE_INGEST_RETIRED =
true`, returning `{ subjects: 0, newItems: 0 }` with zero World service calls, feed pulls, LLM
classifications, or `sports_world_pulls` writes), and removed the unused `team-news-classification`
rating entry and `world-data` floor from `oshal-app.yaml`. Existing `sports_world_pulls` schema,
`sports-world` naming helpers, ESPN coach/roster readers, team following, previews, line capture,
and grading remain intact.

## B. Coach subjects from the followed team's ESPN response — implemented in 0.7.1

The old premise that the bare ESPN team endpoint contains `coaches` was stale. `refreshWorld` now
reads the existing public roster endpoint, `/teams/{id}/roster`, using the followed row's stored
team ID when that team's persistent six-hour cooldown is due. The response's top-level `coach`
array supplies staff; its `team.id` and `team.abbreviation` must both match, and ESPN's team label
supplies coach-query context. Conflicting stored IDs for one shared team omit coach discovery
deterministically. It accepts an explicitly identified
head coach or ESPN's single unlabelled coach entry, and refuses ambiguous staff, mismatched team
IDs and unusable names. No name table or fallback coach is shipped.

The resulting `world:person:<slug>` uses the same World service, news/social feeds, pull ledger and
pass budget as the team. A changed coach is discovered on the next team cycle; the old person's
archive remains historical. Missing coach data creates no person subject. World-disabled
deployments make no coach request. Public archive sharing and each user's followed-team ownership
are unchanged; private Fantasy credentials never enter this public read.

**Provider contract:** normal public reads on 2026-09-11 confirmed the singular array and nested
team identity in the [NFL roster](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/12/roster)
and [NBA roster](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/2/roster).
College-football public roster reads were unavailable during verification; it retains the same
defensive reader through the existing league mapping, with no subject when staff is absent.

**Evidence:** eleven new unit cases exercise the actual compiled refresh, ESPN client
and store functions with synthetic HTTP, World and persistence ports. All eleven package suites
are registered in `tests/test-lab.yaml`; these fixture results are separate from the public schema
check and do not claim live World ingestion or deployed acceptance. The separate wire-to-model
work in A remains open.

## C. "The day the lines come out" is approximated, not known

The operator's ask was specific: know when a line opens, check for an edge that day, then track the
move. What ships is the second half. Capture runs on the refresh cadence (180 min, 21-day horizon)
and `summariseMovement` labels the earliest row honestly — `observed-early` when we saw it 72+ hours
before kickoff, `late-pickup` otherwise — precisely because the first row we saw is **not** the
opening line and treating it as one would corrupt every closing-line-value number computed on top of
it.

What is missing is knowing when a book actually posts. Books open a slate on a schedule (US college
football lines typically post Sunday for the following Saturday), and a three-hour poll can miss the
open by up to three hours — which is exactly the window where a stale opener is most exploitable.

**Done when:** the package knows a per-league expected open window; capture polls tighter inside it
(minutes, not hours) and stays on the slow cadence outside it; a captured row records whether it
landed inside that window; and `openerConfidence` gains a third, stronger level that is only
assigned when the row was captured inside the window AND the previous poll of the same game and book
returned no price. The third level is the point: it is the only condition under which "this is the
opener" is a claim rather than a guess.

## D. The staking gate has no evidence behind it yet

The two-bar gate (UNPROVEN → FAILING/PROVEN) is implemented and every call is registered before
kickoff with the price at pick time. It has not been fed a season. Until it has, the package's own
premise — that a model earns the right to stake by beating the closing line first — is asserted, not
demonstrated.

The walk-forward numbers in the README are real and measured (NFL 62.3%, NBA 66.2%, NCAAF 72.6%
straight-up out-of-sample), and they are **not** the same claim: beating a coin flip is not beating
a price. The kalshi ledger this package was designed against is the cautionary case — 2,507 settled
predictions, better than a coin flip, worse than the market on 70% of them.

**Done when:** at least one league has a full season of graded rows; median closing-line value is
reported on the ledger surface with its sample size; and the gate's verdict for that strategy is
read off measured CLV rather than defaulting to UNPROVEN. No stake is proposed by closing this
entry — a PROVEN verdict is a precondition for that conversation, not the conversation.

## E, F. Moved to fantasy-football (0.11.0)

The fantasy half — and its two entries (a season of graded start/sit rows; the real-server round
trip behind the player-weeks guard) — moved with the code to [`fantasy-football`](../fantasy-football/BACKLOG.md)
(ADR-146 D1). Nothing fantasy-shaped remains open here.
