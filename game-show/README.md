# Game Show — AI game night (ADR-085 app package; architecture ADR-112)

A TV-style game show run by an AI host. One person hosts, everyone joins from their phone
and takes a podium, and the same synced state renders as a broadcast big screen, a phone
buzzer, a host desk, or a spectator view.

The **plug-in engine** below is specified in
[ADR-112 — game shows are plug-ins](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/112-game-shows-as-plugins.md):
one show-agnostic engine, games as modules, adding a show never forks it.

**Status: four shows, each with its own television set, playable solo against AI
contestants, browser-testable end to end.** Family Feud (with **Fast Money**),
Jeopardy (with **Double Jeopardy**), **Wheel of Fortune**, and **Whammy!** all run on the
one engine. A full Feud round is played by an automated browser spec against the real
surfaces (`npm run test:browser`), and the **rehearsal view** plays the whole studio —
big screen, host desk, one clicker per podium, audience — in ONE browser window, so a
playthrough needs no TV and no phones. The remaining human step is taste, not function:
play a round on an actual TV + phones and see that it *feels* right.

Three layers, each independently extendable:

| Layer | What it owns | Add a show by… |
|---|---|---|
| **Engine** (`lib/`) | rooms, buzzer, clock, director, host dispatch, NPC actuation | nothing — it is show-agnostic |
| **Rules** (`lib/shows/<id>.js`) | one game's mechanics, prompts, judge shape, AI brain | one module + one `register()` |
| **Set** (`ui/gs-show-<id>.js` + `ui/gs-set-<id>.css`) | that show's board on camera | one renderer + one stylesheet |

## Nothing can hang, and nothing can wedge

Two engine primitives, both show-agnostic, both inherited free by any show added later:

- **The round clock** (`lib/clock.js`). Shows declare which window is open
  (`windowFor`) and what a lapse means (`onTimeout`); the engine keeps time. **There is
  no scheduler** — the deadline lives in the state and the sync poll IS the tick,
  resolved under the room lock, so two clients racing the same deadline resolve it
  exactly once. Every lapse routes through an *existing* applier, so a timeout can never
  leave the board somewhere a played beat could not. A lapse that resolves into the
  SAME open window (Whammy's multi-press turn) restarts the clock — found by show #4,
  guarded in `tests/timers.test.js`.
- **Host overrides** (`lib/host-override.js`). Extend / pause / resume the clock,
  `forceTimeout` (the universal unstick), `endGame` — plus per-show recovery (re-open
  the buzzer, force-reveal, skip, hand over control). Owner-only, every override logged.

## Shows are plug-ins, not forks

A show is ONE module in `lib/shows/*.js` implementing the `Show` interface (JSDoc in
`lib/shows/show-registry.js`) plus ONE client file `ui/gs-show-<id>.js` registering its
renderer and phase tables via `GS.registerShowUi` (`ui/gs-shows.js` — the per-show
registry that replaced the old lookup tables in `gs-surfaces.js`, exactly the collapse
ADR-112 predicted show #3 would force). Everything else is shared and untouched.

| Piece | File | Show-agnostic? |
|---|---|---|
| Generalized buzzer (server decides first press by write order) | `lib/buzzer.js` | yes |
| Round clock / no-scheduler deadlines | `lib/clock.js` | yes |
| Cutaway director (shots are data) | `lib/director.js` | yes |
| Interview beat (host asks, human really answers) | `lib/interview.js` | yes |
| Rooms / podiums / sync / presence / `mutate()` / reactions / retention | `lib/room-service.js` | yes |
| Host-bot dispatch, judging (LLM + local pre-judge), manual content, cost | `lib/host-service.js` | yes |
| Single-TTS-speaker election | `lib/speaker-lease.js` | yes |
| NPC contestants — skills, timing, poll-driven actuation | `lib/npc.js` | yes |
| Broadcast chrome — set frame, podium characters, sfx, opening titles | `ui/gs-play.js` | yes |
| Family Feud + Fast Money | `lib/shows/family-feud.js`, `feud-fast-money.js` | the show |
| Jeopardy + Double Jeopardy | `lib/shows/jeopardy.js` | the show |
| Wheel of Fortune | `lib/shows/wheel.js` | the show |
| Whammy! (Press Your Luck) | `lib/shows/whammy.js` | the show |

The `Show` interface grew as shows #2–#4 landed, and every addition is **optional** —
a show that implements none of them still runs, it just gives up the feature:

| Optional member | Gives the show | Absent means |
|---|---|---|
| `canGenerate` / `canAnswer` / `isGameOver` | phase gating without leaking phase names into the engine | the engine's permissive defaults |
| `windowFor` / `onTimeout` | timed windows on the shared clock | no beat can time out (a walk-away hangs the round) |
| `override` | show-specific host recovery | only the universal unstick (`forceTimeout`, `endGame`) |
| `localJudge` | free exact-match rulings, no LLM call | every guess costs an LLM judge round-trip |
| `npcMove` | AI contestants that actually play it | NPC podiums idle into the round clock like an AFK human |

## Solo play — AI contestants

**One person can run a whole game night.** `🤖 Solo night` fills the stage: you take a
podium and skill-tiered AI players take the rest (a good one on your side too). They
buzz, answer, pick clues, spin, buy vowels, solve, wager, and press their luck.

- **Zero LLM calls.** An NPC decides against the board the *server already holds*, so
  solo play is free to run, works under `FORCE_LLM_PROVIDER=noop`, and is exactly
  reproducible in tests.
- **No scheduler.** The sync poll IS the tick — same doctrine as the round clock. A due
  move applies under the room lock on whichever surface polls next; racers no-op.
- **The seat identity is the skill.** An NPC is a synthetic `npc:<skill>:<uuid>` subject
  (`sharp` | `casual` | `wild`) — no schema change, and the skill travels wherever seats do.
- **Timing is deliberate, not instant.** Humans get a head start, a room-wide pace floor
  keeps a team of bots from machine-gunning, and priority rotates so one eager bot cannot
  hog every beat. A *shy* roll buzzes **late, never never** — a stage of silently-shy bots
  was 20 seconds of dead air (found live, guarded in `tests/npc.test.js`).
- Bots stay quiet while an interview is live, and a paused game freezes them too.

## The broadcast layer

Opening the app puts you in front of a **television show**, not a control panel — the
admin surface is the host desk, and nothing else. `ui/gs-play.js` is show-agnostic chrome:

- **The set frame** — marquee, light beams, stage floor, and the show's board center-stage.
- **Podium characters** — each player is a face (camera still, avatar, or nameplate) on a
  drawn team-colored podium with an LED nameplate and a live score. Default avatars are
  deduped across the roster so two rivals never share a face.
- **Sound** — `GS.sfx` is a small WebAudio cue synth (no assets, no CDN): reveals ding,
  misses buzz, wins get a fanfare and applause. Cues are scored from the room event log
  via the `GS.onBeat` hook in `gs-core.js`, so a beat any surface can see is a beat it can play.
- **Opening titles** once per game — and the show is *announced*: the first round start
  auto-dispatches the host's `intro` line, so the speaker surface voices the open with
  the titles (caption-only when TTS is unavailable, backlog #4). The lower-third host
  caption renders *nothing* when the host has not spoken (an empty caption bar reads as
  a broken box).
- **One screen, never a scroll.** With the action dock pinned, the frame above it
  compresses to fit — a fixed dock must never knife through the podium row.

Each show dresses that frame with its own set (`ui/gs-set-<id>.css`, scoped by
`body[data-gs-show=<id>]`): Feud's gold flip-card board with a three-slot strike tray and
giant X slams; Jeopardy's monitor wall and full-set clue takeovers; a real 17-segment SVG
**wheel that spins** and parks on the outcome, over a tile puzzle wall; Whammy's ring
board with a chasing arcade light and a 😈 that drains your bank to $0.

**The render-loop rule any new set must follow:** the DOM is rebuilt on every changed poll
(~1.4 s). Continuous animation = ONE module-level ticker repainting existing nodes **by
id** (never creating them); one-shot animation = a module-level *last-seen* comparison
(serial, strike count, revealed mask). A renderer that starts an interval per render
stacks timers until the page dies.

## What the host can do beyond the AI

- **Play your own questions.** The host desk's "✍ Use my own questions" panel takes a
  plain-text Feud survey (or any show's generated-JSON shape) and runs it through the
  same validation the model's output gets — game night with YOUR questions, zero LLM.
- **Exact answers rule free.** `show.localJudge` rules an exact text/alias hit without
  an LLM call; only fuzzy guesses go to the lenient AI judge. Cheaper, instant, and the
  deterministic rail the automated browser playthrough rides.
- **See the tab.** The host desk shows this room's real spend (from `chat_tasks`,
  keyed by the room-scoped host task ids) — backlog #15.

## Surfaces

One synced state, selected by `?view=`. **Players see the SHOW, never an admin page**
(2026-07-26 rebuild, audited against the DnD table as the quality bar):

- `stage` — the broadcast picture full-bleed with a floating bottom **action dock**
  that appears only when it's your moment (buzz bar, answer pad, wager, spin). The
  dock lives on `document.body`, pinned inside the viewport — the audit measured the
  old buzzer at 933px in an 844px phone viewport mid-buzz-window; that class of bug
  is now asserted against in the browser spec.
- `clicker` — the **buzzer mode**: one giant button that explains itself when it's
  dark, with the answer pad docked below. A phone picks show-vs-buzzer on first
  join and can switch anytime (🔴/📺); `&as=<seatId>` pins a hotseat podium (owner-only).
- `tv` — broadcast chrome; the lobby phase is the invitation: giant join code + a
  **scannable QR** (`GET /qr`, served with the platform's qrcode dep) + live podiums.
  An idle TV self-onboards when a room appears.
- `host` — the MC's tools: one ▶ button, the answer key, your-own-questions, podium
  and AI-player admin; the phase pills, overrides, hotseat, interview, cutaway
  previews and cost fold into a 🔧 Show-tools drawer.
- `audience` (watch + broadcast reactions, no operator chrome), `help`, and
  **`rehearsal`** — every surface as live iframes over one room, in one window.

**Joining is two gestures:** scan the QR on the TV → the deep link auto-joins and
seats you (zero taps) → pick your mode/team. Waits are narrated in-world ("The host
is writing your questions… 15–40s") instead of silent buttons.

Answers can be **spoken**: the answer box grows a 🎤 button where the Web Speech API
exists (Chrome/Edge); the transcript submits as the guess. Typing stays the fallback
everywhere else — feature-detected, never required.

Exactly **one device per room speaks** the host's lines (backlog #8): speaker surfaces
claim a short-TTL lease each poll (TV outranks the host desk), lines queue instead of
overlapping, and everyone else stays caption-only.

All surfaces load the swarm control plane's saved theme and follow live theme changes.
The mobile layouts scroll vertically, collapse boards to one readable column, preserve
44px touch targets, and stack the one-window rehearsal studio instead of clipping its
visualizations off-screen.

### Broadcast cutaways

The semantic director now drives six reusable full-screen transitions: show open,
buzzer race, team huddle, interview, strike, and celebration. Each transition has a
zero-dependency HTML/CSS animation, including a reduced-motion treatment. If a matching
silent MP4 exists under `ui/cutaways/`, the player uses it automatically; missing,
blocked, or failed video always reveals the local animation underneath. The Host Desk
has preview buttons for auditioning every transition without advancing a round.

The asset contract is documented in `ui/cutaways/README.md`. This keeps rendered Google
Vids clips swappable and optional rather than making game play depend on a media worker.

### Buzz fairness (backlog #17 — deliberate trade-off)

First-press is decided by **server write order** under the room lock. This favors
low-latency devices by design: the app is **local-play-first** (a living room on one
Wi-Fi, skews of a few ms), and a collect-window scheme would add 150–300 ms of dead air
to every single buzz to protect a case (mixed remote play) the presence camera and TTS
paths don't really serve anyway. If remote play ever becomes a real mode, the buzzer is
one module — a ranked collect window slots into `lib/buzzer.js` without touching shows.

## Run the tests

`npm test` runs all thirteen engine suites (548 checks) — no dependencies, plain node.
They also run in CI on every store-repo PR (`.github/workflows/store-ci.yml`, backlog #12).

```bash
npm test
node tests/game-show-engine.test.js   # 35 — buzzer, face-off, strikes, steal, scoring
node tests/npc.test.js                # 60 — skills, due-timing, pacing, all four show brains
node tests/jeopardy.test.js           # 55 — board, ring-in, Daily Double, DOUBLE JEOPARDY, final
node tests/host-guards.test.js        # 25 — spoken-line sanitizing, tolerant JSON, auto-narrated open
node tests/timers.test.js             # 42 — windows, lapses, pause/extend, expired-restamp
node tests/overrides.test.js          # 32 — clock control, universal unstick, per-show recovery
node tests/fast-money.test.js         # 46 — gate, runs, duplicates, handoff, 200-point bonus
node tests/speaker-lease.test.js      # 13 — one voice per room, TV priority, TTL self-heal
node tests/wheel.test.js              # 90 — turn claim, spins, letters, vowels, solve
node tests/whammy.test.js             # 87 — lazy spins, whammy knockout, pass-to-leader
node tests/whammy-set.test.js         # 36 — the REAL set renderer in a vm: closed ring at 8-12 panels, current-beat centre screen
node tests/leaderboard.test.js        # 13 — caller-scoped hall-of-fame read, lobby shape
node tests/cutaways.test.js           # 14 — catalog, state selection, media allowlist
```

`tests/npc.test.js` plays full NPC-vs-NPC Feud, Wheel, and Whammy rounds in-process, so
"solo night actually finishes a game" is a guard, not a hope.

**The browser playthroughs** (the P0 that used to need a human, a TV and two phones):

```bash
# Against the local stack (live auth): mint a PAT, then run all four shows
GS_PAT=oshal_pat_... npm run test:browser
# Against a MOCK_OIDC dev server: run all four, or one named scenario
GS_BASE_URL=http://localhost:35457 npm run test:browser
GS_BASE_URL=http://localhost:35457 npm run test:browser:jeopardy
# Watch it play: GS_HEADED=1
```

The Feud scenario opens the real tv / host / two pinned clickers / audience pages, plays
a full round deterministically (manual survey + exact answers → localJudge; a miss via
the host's "move it along"), asserts the reveals, celebration, reaction broadcast and
$0.00 cost chip, then screenshots the rehearsal grid.

The APP-05 scenarios reuse the same authenticated package routes and real Chromium
surfaces: Jeopardy locates the server-randomized Daily Double after a normal ring-in;
Wheel follows live turn ownership through random wheel outcomes before calling a
present consonant and solving; Whammy presses the rendered board until it observes a
visible server-owned Whammy. No scenario injects an outcome or invokes an LLM.
Playwright resolves from the core repo checkout (or `PLAYWRIGHT_MODULE`). An unreachable
or unauthenticated server is reported as **BLOCKED**, never as a passing browser run.

Random content (Daily Double slots, wheel segments, whammy stops) is **located, never
assumed** — keep that habit in new specs.

**The set photographer** (`npm run test:shots`) stages every show at photogenic beats and
screenshots both `?view=tv` and `?view=stage` into `_playthrough-shots/sets/`. It asserts
nothing about pixels — it exists so a human (or a review agent) can *look* at four sets in
one pass instead of hand-driving four games. Same env contract as the playthrough.
Staging is deterministic (backlog #9): scripted actions run with no NPC seated, the
round clock is paused before any page opens (a paused timer freezes NPC actuation and
timeouts), and the 🤖 sharp podium is seated only after the live beat is staged — so
the bot character renders without ever being able to take the beat first.

```bash
GS_PAT=oshal_pat_... npm run test:shots
```

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

## Data retention

- Ending a game **prunes its presence frames** immediately and **snapshots final
  standings** into `gameshow_seats.score` (state jsonb stays authoritative during play;
  backlog #13/#19). The lobby's 🏆 **Hall of fame** reads those snapshots back —
  `GET /leaderboard`, caller-scoped to games you hosted or played (#11).
- Rooms ended 7+ days ago purge opportunistically on create/list, cascading state,
  seats, events, and presence (backlog #14 — same no-scheduler pattern as the clock).
- Camera capture backs off to ~6 s while the director holds a plain board shot.

---

# Backlog — next steps

Ordered. Each has a done-when so scope isn't re-guessed. Items marked **[judged]** came
out of the 2026-07-26 screenshot review panel and are recorded as *reported*, not
reproduced — confirm the shot before you spend a fix on it.

## P0 — blocking real use

1. **Real-device feel pass.** The mechanics are browser-proven (`npm run test:browser`
   + the rehearsal view) and every set has been photographed (`npm run test:shots`);
   what's left is the couch test.
   Done when: a host on a laptop + two phones + a TV play one full round of any show and
   the pacing/readability feel right at TV distance.

2. **Live-test the interview beat + spoken answers on a phone.** The interview
   round-trip and the 🎤 answer path are built and unit/browser-covered, but a real
   mic + a real host-bot reaction have not been exercised together.
   Done when: a contestant answers an interview question by voice and the host reacts,
   on a phone.

## P1 — the set still has seams on camera

6. **Motion-avatar presence module (the shark).** The slot already exists in
   `ui/gs-presence.js` `tile()`.
   Done when: a player can pick an avatar that tracks their head/mouth from the camera
   and renders in place of the still, with no change to any other module.

7. **The rendered cutaway MP4s.** The six transitions all have CSS fallbacks today and
   the asset contract is documented (`ui/cutaways/README.md`); the Google Vids render was
   dispatched to a desktop node and has not landed.
   Done when: the named MP4s exist under `ui/cutaways/` and the player prefers them, with
   the CSS animation still covering a missing or blocked file.

## P2 — test coverage and operability

8. **Record the other-three-shows browser run.** The fail-closed Playwright scenarios now
   exist and are wired into `npm run test:browser`: Jeopardy drives a ring-in plus a
   located Daily Double wager; Wheel drives a live spin, present consonant and solve;
   Whammy presses until the server produces a visible Whammy. The 2026-08-06 local run
   could not reach either `localhost:35457` or `127.0.0.1:35457`, so this stays open
   rather than treating unavailable infrastructure as a pass.
   Done when: all three named scenarios pass against a reachable authenticated local
   server and the result is recorded alongside the commit SHA.

10. **Push and install via the sanctioned path.** Currently installed by `docker cp`.
    Done when: the package is pushed and installed via `scripts/oshal-app.js install
    game-show --ref main`, leaving a provenance stamp.

## Done (2026-07-31 backlog pass — v0.10.0)

- ~~Whammy's ring breaks under 12 panels~~ (#3) → dimmed filler cells close the ring at
  every count the generator allows (8–12); guarded by `tests/whammy-set.test.js`, which
  drives the real renderer in a vm (the shot-based verification the item asked for still
  needs a live stack — the vm guard asserts the exact DOM the shot would photograph)
- ~~The show opens in silence~~ (#4) → the first round start auto-dispatches the host's
  `intro` line, fire-and-forget; the speaker-lease surface voices it with the titles,
  caption-only when TTS is unavailable (guarded in `tests/host-guards.test.js`)
- ~~Whammy's centre screen can hold a stale readout~~ (#5) → a stop/whammy readout is a
  timed beat: the ticker hands the screen back to the attract marquee, a page opened
  mid-game starts on attract, and no readout renders outside the lights phase
  (`tests/whammy-set.test.js`)
- ~~The set photographer races the NPC~~ (#9) → deterministic staging: no NPC during
  scripted actions, clock paused before any page opens, NPC seated last and frozen
- ~~Cross-game leaderboard surface~~ (#11) → `GET /leaderboard` (caller-scoped over the
  `gameshow_seats.score` snapshots) + the lobby's 🏆 Hall of fame panel
  (`tests/leaderboard.test.js`)

## Done (2026-07-25 → 07-26 — see git history)

- ~~Solo play against AI~~ → `lib/npc.js` + `npcMove` brains in all four shows, zero LLM
  (v0.6.0 Feud/Jeopardy, v0.7.0 Wheel/Whammy/Fast Money)
- ~~The lobby was unreachable~~ → auto-resume no longer traps you in the last room;
  ☰ New game + an open-games list with Resume/End (v0.6.0)
- ~~"All I could get to were admin screens"~~ → the broadcast layer: set frame, podium
  characters, sfx, opening titles, and a real set per show (v0.9.0)
- ~~Players saw an admin page~~ → full-bleed play view, pinned action dock, buzzer mode,
  zero-tap QR join (v0.8.0)

## Done (2026-07-24 backlog burn-down — see git history for the change set)

- ~~Browser playthrough~~ → automated (`tests/browser-playthrough.test.js`) + the
  one-window rehearsal view; Jeopardy generation half was already live-proven 07-22.
- ~~Round/answer timers~~ (07-22) · ~~Host override controls~~ (07-22)
- ~~Speak your answer~~ → 🎤 on every answer box, typed fallback (#5)
- ~~Fast Money~~ (#6) · ~~Double Jeopardy~~ (#7) · ~~single TTS speaker + queue~~ (#8)
- ~~Wheel of Fortune~~ (#9) · ~~Whammy / Press Your Luck~~ (#10)
- ~~Test runner in CI~~ → store-repo PR workflow (#12)
- ~~Presence frame retention~~ (#13) · ~~Ended-room cleanup~~ (#14)
- ~~Per-room cost visibility~~ (#15) · ~~Broadcast audience reactions~~ (#16)
- ~~Buzz fairness~~ → documented as a deliberate local-play-first trade-off (#17)
- ~~Decide `gameshow_seats.score`~~ → end-of-game snapshot, leaderboard hook (#19)
