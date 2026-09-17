# sports-edge — BACKLOG

Open work on the packaged odds maker. Every entry has a done-when so scope does not have to be
guessed later.

**Posture (v0.7.1).** The package ships and runs. It follows a team, builds a line from Elo +
schedule-adjusted power ratings + an offence-versus-defence unit matchup, adjusts for injuries by
each player's real share of production, compares that line to DraftKings' moneyline and spread, and
registers every call before kickoff. Line capture is live and change-only. The fantasy half now sets
a lineup against the opponent you actually play, hill-climbing on P(win) rather than on projected
points (0.6.0). There is **no order path**, by design.

What is below is the honest remainder. Two of these are gaps a reader would otherwise assume are
closed, because the machinery around them exists.

---

## A. The archived wires are written but never read

`refreshWorld` (v0.5.0) feeds followed teams, their injury wire and their upcoming matchups into
World Intelligence. That is the **ingest** half only. `buildPreview` does not read any of it back:
the line is still made from the tape, the injury report and the unit matchup, exactly as it was in
0.4.1.

So the wires are being archived and classified, and they change no number. Anyone reading "news
feeds" in the manifest would reasonably assume otherwise, which is why this is stated here rather
than left to be inferred.

Reading them back is not a small wiring job, and it should not be done casually. Sentiment is the
easiest signal in this package to fool yourself with: it is available, it moves, it correlates with
outcomes in-sample, and it is very good at adding variance to a model that is already close to the
market. Whatever is added has to be walk-forward tested against the current ensemble before it is
allowed to move a line.

**Done when:** a candidate signal is derived from `world_items` for a team (the shape is open — a
sentiment delta over a window, or an injury-item count, or a classified-event flag); it is measured
walk-forward on a completed season with the CURRENT ensemble as the control; the measured effect on
Brier and MAE is written into the README beside the existing walk-forward table; and it enters the
ensemble only if it improves the control. A negative result closes this entry just as well as a
positive one — record it and remove the ingest cost.

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

## E. Fantasy start/sit is graded but has no season either

Same shape as D, smaller stakes. Every start/sit call is registered before kickoff and graded
against what the benched player actually scored, and the ledger deliberately keeps the PROJECTED
gain beside the ACTUAL one — "claimed +40, delivered +2" and "claimed +3, delivered +2" are very
different tools and a win rate hides that completely. Nothing has been graded yet.

0.6.0 raised the stakes on this rather than lowering them. The optimiser no longer maximises
projected points — it hill-climbs on `P(win)` against the opponent's own projected lineup, which
means it will now **deliberately give up projected points** to buy tail when you are an underdog.
That is the right objective and it is also strictly harder to check by eye: a lineup that scores
less than the mean-maximal one looks like a mistake unless the win-probability arithmetic behind it
is correct. Grading is the only thing that can tell those two apart.

**The blocker is a credential, and it is not this package's to fix.** There is still no
`espn-fantasy` row in `oshal_connections` (checked on the box 2026-09-09), so every fantasy code
path here — including all of 0.6.0 — has only ever seen fixtures and the public feed. A real league
is what turns this entry from unstartable into merely unfinished; core's ESPN capture entry is the
one that unblocks it.

**Done when:** a real league is linked; a season of graded start/sit rows exists; and the surface
shows projected-versus-actual gain **and** the realised win rate against the P(win) the optimiser
claimed, not just a win rate. The second number is the one that says whether the objective change in
0.6.0 paid for itself.

## F. The player-weeks round trip is real code with no CI that runs it against a real server

`sports_fantasy_player_weeks` (0.9.0) is a new table, and the guard that proves the lineup route
writes it and reads it back doubles the round trip: `tests/sports-fantasy-history.test.js` serves
the INSERT and the SELECT from memory, decoding the parameters the store's own statements actually
send. That is enough to prove the ROUTE wiring — which is what shipped broken — and it is not
enough to prove PostgreSQL accepts the statements, because a double cannot refuse a bad one.

The real half exists and passes: `tests/postgres/player-weeks-contract.mjs` runs the shipped
migration, the runtime self-heal DDL over the migrated schema, the chunked upsert and its
idempotence over a real primary key, the JSONB round trip, and the read's season / week-exclusive /
roster bounds, reading every row back over a second connection. Verified 2026-09-16 against a
disposable `postgres:16-alpine` on 127.0.0.1:55491 — 1,007 rows across 3 chunks, 236ms, all seven
clauses PASS; deleting the `ON CONFLICT` clause turns it red with `duplicate key value violates
unique constraint "sports_fantasy_player_weeks_pkey"`, so the server is genuinely enforcing.

**Nothing runs it automatically.** The sports-edge CI job is `node --test "tests/*.test.js"` with no
framework checkout, no `npm install` and no service container, so it has neither a `pg` driver nor a
database. Adding a case that SKIPS without one is worse than this entry: the local gate exits
non-zero on a skip, and the sanctioned skip list does not include this package. The double is
recorded, with this file named as its real companion, in the core repository's
`docs/governance/real-boundary-regression-audit.md`.

**Done when:** the sports-edge store-ci job gains a PostgreSQL service container and a step that
runs `tests/postgres/player-weeks-contract.mjs` against it, `scripts/store-ci-local.mjs` learns the
env var as a capability so a workstation without a database is reported as an explicit skip rather
than a silent pass, the sanctioned-skip list in `CONTRIBUTING.md` is extended to name it, and the
audit row moves from "outstanding" to the companion file.
