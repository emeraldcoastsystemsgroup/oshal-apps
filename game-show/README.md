# Game Show — AI game night (ADR-085 app package; architecture ADR-112)

A TV-style game show run by an AI host. One person hosts, everyone joins from their phone
and takes a podium, and the same synced state renders as a broadcast big screen, a phone
buzzer, a host desk, or a spectator view.

The **plug-in engine** below is specified in
[ADR-112 — game shows are plug-ins](https://github.com/emeraldcoastsystemsgroup/open-shal/blob/main/docs/adr/112-game-shows-as-plugins.md):
one show-agnostic engine, games as modules, adding Wheel of Fortune or Whammy never forks it.

**Status: built, installed, and live-verified on the local swarm.** A full Family Feud round
has been played end to end against the real host bot (survey generated, buzz locked, fuzzy
answer judged, three strikes, steal, crown). Jeopardy's board now generates live too — a real
6×5 board with values, one Daily Double, and usable clues, parsed and mounted (~41s for the
generation call, so the host desk should expect a wait). The round clock and the host override
panel are live-proven against a real room. **Still not exercised in a browser on real devices**
— that is the one remaining P0 and it needs a human, a TV and two phones.

## Nothing can hang, and nothing can wedge

Two engine primitives, both show-agnostic, both inherited free by any show added later:

- **The round clock** (`lib/clock.js`). Shows declare which window is open
  (`windowFor`) and what a lapse means (`onTimeout`); the engine keeps time. **There is
  no scheduler** — the deadline lives in the state and the sync poll IS the tick,
  resolved under the room lock, so two clients racing the same deadline resolve it
  exactly once. Every lapse routes through an *existing* applier (a dead Feud answer is
  the judged-miss path; a dead Jeopardy response is `applyClueRuling(false)`), so a
  timeout can never leave the board somewhere a played beat could not.
- **Host overrides** (`lib/host-override.js`). The shared half — extend / pause / resume
  the clock, `forceTimeout`, `endGame` — works in every show, including one that
  implements nothing optional. `forceTimeout` is the universal unstick: it produces
  exactly the board a real lapse would. The show half (re-open the buzzer, force-reveal,
  skip, hand over control) is delegated. Owner-only, and **every override writes a
  milestone event** — a game that silently rearranges itself is worse than a stuck one.

## Shows are plug-ins, not forks

The engine is show-agnostic. A show is ONE module in `lib/shows/*.js` implementing the
`Show` interface (see the JSDoc in `lib/shows/show-registry.js`), plus one renderer in
`ui/gs-surfaces.js`. Everything else — rooms, podiums, presence, the buzzer, the cutaway
director, the interview beat, sync, the host bot, TTS — is shared and untouched.

| Piece | File | Show-agnostic? |
|---|---|---|
| Generalized buzzer (server decides first press by write order) | `lib/buzzer.js` | yes |
| Cutaway director (shots are data) | `lib/director.js` | yes |
| Interview beat (host asks, human really answers) | `lib/interview.js` | yes |
| Rooms / podiums / sync / presence / `mutate()` | `lib/room-service.js` | yes |
| Host-bot dispatch, judging, spoken-line sanitizing | `lib/host-service.js` | yes |
| Family Feud | `lib/shows/family-feud.js` | the show |
| Jeopardy | `lib/shows/jeopardy.js` | the show |

Adding **Wheel of Fortune** = `lib/shows/wheel.js` + `register()` + a renderer entry in
`BOARDS`/`ANSWER_PHASES`/`WAGER_PHASES`/`START_PHASES`. Nothing else changes.

> Adding show #2 (Jeopardy) is what exposed the engine's last two Feud-specific
> assumptions. **Expect show #3 to find the next one — build it, don't theorize.**

## Surfaces

One synced state, selected by `?view=`: `tv` (broadcast, no controls), `stage`
(desktop/solo), `clicker` (phone buzzer), `host` (MC desk + hotseat), `audience`, `help`.

## Run the tests

`npm test` runs all five suites (167 checks). Store-repo specs still have **no CI runner**,
so this is a command a human has to type — see backlog item 12.

```bash
npm test
node tests/game-show-engine.test.js   # 35 — buzzer, face-off, strikes, steal, scoring
node tests/jeopardy.test.js           # 41 — board, ring-in, Daily Double, final wagering
node tests/host-guards.test.js        # 19 — spoken-line sanitizing, tolerant JSON
node tests/timers.test.js             # 40 — windows, lapses, pause/extend, no beat hangs
node tests/overrides.test.js          # 32 — clock control, universal unstick, per-show recovery
```

Both newer suites **locate** clues rather than assuming a slot: Jeopardy's Daily Double
lands at random, so a hard-coded `[0][0]` passes nine runs in ten and then fails for no
reason. Keep that habit when adding show #3.

## Deploy locally

The store checkout is **not** bind-mounted into the api container; packages live in the
`oshal_workspace` volume. `oshal-deploy.sh` does not ship them.

```bash
docker exec oshal-local-api sh -c "rm -rf /app/workspace-shared/deployed-apps/game-show"
docker cp ./game-show/. oshal-local-api:/app/workspace-shared/deployed-apps/game-show
docker restart oshal-local-api    # boot auto-loader picks up deployed-apps/
```

Node caches `require`s and the route factory reads UI sources once at mount, so **any**
change needs the restart (or a `POST /api/swarm/apps/load` with a PAT).

---

# Backlog — next steps

Ordered. Each has a done-when so scope isn't re-guessed.

## P0 — blocking real use

1. **Browser playthrough on real devices.** ← **the only P0 left**
   Done when: a host on a laptop + two phones + a TV play one full Feud round; podium
   presence, buzz race, captions and celebration all render correctly on each surface.

2. ~~**Round/answer timers.**~~ **DONE 2026-07-22.** `lib/clock.js` + `windowFor`/`onTimeout`
   per show; countdown chip on every surface and a big ring on the TV, all counting to the
   *server* deadline via a per-poll skew measurement. Live-proven: a clue nobody rang in on
   retired itself on the next poll. Guard: `tests/timers.test.js`.

3. ~~**Host override controls (stuck-game recovery).**~~ **DONE 2026-07-22.** Host desk panel:
   +30s / pause / resume / "move it along", re-open buzzer, force-reveal, skip round or clue,
   clear a strike, hand over control, remove a podium, end the game. Live-proven including
   the paused-clock case. Guard: `tests/overrides.test.js`.

4. **Live-test the interview beat.** *(Jeopardy generation half DONE 2026-07-22 — a real 6×5
   board generated, parsed, and mounted; a lapsed clue and the overrides were driven against
   the live room.)* Still unproven live: a clue rung in and ruled by a human, and the
   interview round-trip.
   Done when: a contestant rings in and the host bot rules the response, and an interview
   question → human answer → host reaction completes.

## P1 — makes it feel like a real show

5. **Speak your answer instead of typing it.** The phone should listen.
   Done when: the clicker uses the Web Speech API to transcribe and submit a guess, with a
   typed fallback when unsupported or denied.

6. **Fast Money (Feud endgame).** The signature round is missing.
   Done when: two players answer five generated questions against a clock, scores combine
   toward 200, and the surface shows the classic reveal.

7. **Double Jeopardy round.** Jeopardy plays one board then the final.
   Done when: a second board generates at doubled values before Final Jeopardy.

8. **Elect a single TTS speaker + queue lines.** Every speaker surface currently requests
   its own audio — duplicate cost and overlapping playback.
   Done when: exactly one device per room synthesizes, lines queue instead of overlapping,
   and the rest stay caption-only.

## P2 — the modular payoff

9. **Wheel of Fortune module.** Also the best stress test of the interface: letter guessing
   needs no LLM judge, only puzzle generation.
   Done when: puzzle board, spin, buy-a-vowel, and solve play through with the shared
   buzzer/director untouched.

10. **Whammy / Press Your Luck module.**
    Done when: the light-chase board, spin/stop, whammy loss and banked cash play through.

11. **Motion-avatar presence module (the shark).** The slot already exists in
    `ui/gs-presence.js` `tile()`.
    Done when: a player can pick an avatar that tracks their head/mouth from the camera and
    renders in place of the still, with no change to any other module.

## P3 — hygiene and operability

12. **Wire a test runner.** *(Half done 2026-07-22: `npm test` runs all five suites, 167
    checks — but it still only runs if a human types it.)*
    Done when: a CI job (or the core gate) runs the package suites and fails red on a break.

13. **Presence frame retention.** Every player writes a ~30KB JPEG to Postgres every 2.2s
    with no pruning.
    Done when: frames are pruned on room end, cadence backs off when no shot features
    podiums, and a size cap is enforced.

14. **Ended-room cleanup.** `gameshow_*` rows accumulate forever.
    Done when: ending a game purges or archives its state/events/presence on a retention
    policy.

15. **Per-room cost visibility.** Host-bot calls bill the room owner invisibly.
    Done when: the host desk shows this game's spend from `chat_tasks`.

16. **Broadcast audience reactions.** Emoji are local-only; nobody else sees them.
    Done when: a reaction is an event other surfaces render.

17. **Buzz fairness for remote players.** First-press is decided by server write order,
    which favors low-latency devices.
    Done when: presses collect for a short window and rank with clock-skew correction, or
    the trade-off is deliberately documented as local-play-first.

18. **Push and install via the sanctioned path.** Currently installed by `docker cp`.
    Done when: the package is pushed and installed via `scripts/oshal-app.js install
    game-show --ref main`, leaving a provenance stamp.

19. **Decide `gameshow_seats.score`.** Currently an unused column (state jsonb is
    authoritative in play).
    Done when: it either persists an end-of-game snapshot for a cross-game leaderboard, or
    is dropped.
