# sports-edge — BACKLOG

Open work on the packaged odds maker. Every entry has a done-when so scope does not have to be
guessed later.

**Posture (v0.6.0).** The package ships and runs. It follows a team, builds a line from Elo +
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

## B. Coach subjects are defined but never pulled

`coachSubject` / `coachEntityId` exist and are guarded, and `refreshWorld` never calls them. The
reason is plain: the package has no coach source wired. ESPN's team endpoint carries a coaching
staff, but it is not read anywhere today, and inventing a name from a hardcoded table is exactly the
kind of thing that goes stale silently and then poisons an archive under a wrong id.

**Done when:** the head coach for a followed team is read from ESPN's team endpoint (not typed into
this repo), a `world:person:<slug>` subject is pulled on the same cool-down as the team, and a guard
proves that a team with no coach in the response produces NO subject rather than one named
`world:person:` or `world:person:undefined`.

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
