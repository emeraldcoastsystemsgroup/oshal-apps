# fantasy-football — BACKLOG

Open work on the packaged fantasy management engine. Every entry has a done-when so scope does not
have to be guessed later. The platform-level entry is core `docs/BACKLOG.md` *"Fantasy football — the
draft engine, the league site, and the live-draft node"*; the design is ADR-146 and
`docs/apps/fantasy-football-spec.md` in the core repository.

**Posture (0.2.0).** The management engine that sports-edge carried (0.2.0 to 0.10.0 there) lives
here now, per person: every table is walled by forced exact-owner row security with no operator arm,
and only the caller's own ESPN connection is spent. It sets the lineup with the best chance of beating
this week's opponent, prices waivers and trades over the rest of the season, runs on a hand-typed
league with no connection, and records and grades every week. There is no route that changes
anything on ESPN.

---

## A. Rest-of-season value still prices unread weeks from a rate, and ESPN leagues have no bye table

0.2.0 built the P0 residuals (rest-of-season SV/MV, hand-typed leagues with the parity guard, the
waiver board, the two-sided trade finder, week grading). What it could not do inside this package: the
`fantasy-leagues` skill distils ONE week per ~39MB read, so a remaining week the caller has not read
is priced from this week's projection as a rate. ESPN's feed carries every week's own projection
(verified on a captured response 2026-09-28), and a bye week is a projection row with no stats. The
skill also reads no pro-team bye table, so an ESPN league's byes are unknown on the rate weeks. Every
response says which weeks came from which.

**Done when:** the `fantasy-leagues` kernel skill (core) exports a multi-week distil — the remaining
weeks' projection rows from the same single read — and the pro-team bye weeks (ESPN's public
`proTeamSchedules_wl` season view, verified 2026-09-28 to carry `byeWeek` per pro team without a
credential); `buildSeasonPlan` takes both; and a response for an ESPN league lists no rate weeks and
reports `byesKnown: true`.

## A2. The season objective is expected points, not P(playoffs)

Spec 2.2.5's season-level objective — simulate the remaining schedule and maximise P(making the
playoffs) rather than total points — is not built. The waiver board and the trade finder rank by SV.

**Done when:** a schedule simulation over the remaining fixtures (standings from the league read or
a hand-typed table) reports P(playoffs) with and without a claim or trade, and a guard shows that a
team two games out prefers the higher-variance option a bubble team does not.

## B. The start/sit ledger has no season yet

Every start/sit call is registered before kickoff and graded against what the benched player
actually scored, and the ledger keeps the PROJECTED gain beside the ACTUAL one — "claimed +40,
delivered +2" and "claimed +3, delivered +2" are very different tools and a win rate hides that.

The optimiser does not maximise projected points — it hill-climbs on `P(win)` against the opponent's
own projected lineup, so it will deliberately give up projected points to buy tail when you are an
underdog. That lineup looks like a mistake unless the win-probability arithmetic behind it is
correct, and grading is the only thing that can tell those two apart.

**Done when:** this package is installed on the box, a real league is linked HERE (a league linked in
sports-edge does not carry over), a season of graded weeks exists in the week ledger, and the surface
shows the realised win rate beside the P(win) the optimiser claimed. The week ledger (0.2.0) already
records the claimed P(win) and grades advised against started. It does not yet read each week's result
against the opponent, so a realised win rate cannot be computed yet.

## C. The cross-user proof runs on a disposable PostgreSQL that no CI job starts

`tests/fantasy-isolation.spec.ts` (run by `tests/isolation.core.test.js`) is the real-boundary proof
of per-person ownership: forced policies, a NOBYPASSRLS owner role, the real connection lookup and
broker, the real routes over HTTP, and 522 player-weeks written across the 500-row insert chunk. It
needs Docker and a framework checkout with its `node_modules`, so the package's store-ci job (plain
node, `tests/*-*.test.js`) deliberately does not reach it; it is registered in `tests/test-lab.yaml`
and run locally. It is also the real companion of the in-memory round trip in
`tests/fantasy-history.test.js` — the role sports-edge's `tests/postgres/player-weeks-contract.mjs`
played before the move. The core audit row that still names that sports-edge file
(`docs/governance/real-boundary-regression-audit.md`) needs re-pointing here.

**Done when:** a store-ci job (or `scripts/security/run-framework-coupled-tests.mjs`) runs
`tests/isolation.core.test.js` against a PostgreSQL it provisions, `scripts/store-ci-local.mjs` maps
the requirement as a capability so a workstation without Docker reports an explicit skip rather than
a silent pass, and the core audit row names `fantasy-football/tests/fantasy-isolation.spec.ts`.
