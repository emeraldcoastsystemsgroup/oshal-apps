<!--
CHANGE LOG
-------------------------------------------------------------------------------
DATE/TIME (America/Chicago) | AUTHOR                                      | DESCRIPTION
-------------------------------------------------------------------------------
2026-07-21 23:38:24 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Initial launch-blocking gameplay, multiplayer, presentation, recovery, and acceptance specification.
2026-07-22 10:10:58 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require automated phases to remain readable and serialize natural narration behind a bounded fail-open pacing deadline.
2026-07-22 21:59:59 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require synchronized Story beats to use the combat narration queue and completed attacks to advance after defeating their persisted target.
2026-07-22 22:19:02 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Separate exact tactical records from dynamic cinematic combat prose and prohibit repetitive automated turn questions.
2026-07-22 23:04:49 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require persistent quest continuity, round highlights, and a cockpit-free full-screen game surface.
2026-07-22 23:30:56 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require honest action-resource locks and a full-surface current-versus-potential character view.
2026-07-23 00:10:04 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require recent-timeline story memory, the immersive gameplay rail and chat, and deduplicated round/kill imagery.
2026-07-23 11:21:50 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require current narration to survive multiplayer synchronization and finish before the next automated state.
2026-07-23 13:15:00 CDT     | roger.murphy@emeraldcoastsystemsgroup.com   | Require selectable four-act stories, shared evidence-driven investigation, named supporting casts, and earned climaxes before tactical combat.
-->

# Dungeon Master Gameplay Specification

Status: launch-blocking contract for the existing D&D tabletop application.

This document defines what “playable” means. The deterministic game engine owns rules and state; the AI Dungeon Master may describe accepted facts and propose bounded story directives, but it may never invent, skip, or mutate a tactical result.

## 1. Product contract

1. A signed-in person can own or join any number of campaigns and keep any number of reusable saved characters.
2. Signing in always opens **My Games**. It never silently enters the last campaign.
3. Every D&D campaign has exactly four hero seats and supports one to four human players. Empty seats are AI Companions, so one registered user can immediately play a complete four-hero game.
4. Every combatant follows the same visible turn grammar: **Announce → Position → Action → Target/Defense → Dice → Apply → Story → Advance**.
5. Every accepted state change is durable, synchronized, attributable, replayable, and protected by server-side authority checks.
6. Captions and deterministic gameplay are the product. Natural audio never
   determines a rule or state transition. Once natural playback starts, the
   current presentation must not Advance until that line ends. Provider,
   decoding, autoplay, and missing-ended-event failures remain bounded by the
   narration watchdog and release to captions without a robotic substitute.
   Ordinary multiplayer synchronization must never cancel active narration.
7. The action dock offers only actions the active hero can currently pay for.
   The full character view separately preserves known potential and explains
   spent spell slots, limited resources, inventory, equipment, and features.
8. Full-screen play removes cockpit chrome and keeps one right gameplay rail
   available for the active character, ready actions, carried items, current
   quest, latest story, suggested actions, and Dungeon Master conversation.
9. Every story request receives recent current-branch history. Later durable
   events override earlier premises; revisiting a place never restarts an
   encounter or erases a completed rescue, bargain, discovery, or defeat.
10. Combat receives one deduplicated illustration per round, counting the
    opening as round one, plus an exact confirmed defeat tableau when a target
    falls. Reconnects and multiple players share the same event identity.
11. A player can ask the Dungeon Master for known facts, searchable leads, or
    help getting unstuck. Questions receive direct grounded answers; declared
    actions alone can advance fiction or request a visible rules roll.
12. A downed hero sees the exact death-save d20 and the prior success/failure
    score. When damage suffered at 0 HP already added a failure, the result must
    distinguish that prior failure from the one added by the current roll.
    An interrupted saved result retries presentation and may never strand
    initiative without either a die control or automatic recovery.
13. Starting a campaign begins with an explicit story choice. Every authored
    campaign identifies a beginning, middle, climax, and falling action; gives
    the party a purpose before combat; sustains a mystery through named people,
    places, and objects; and closes the consequences after the climax.
14. Exploration discoveries are server-authored, shared by the whole table,
    prerequisite-gated, archived, and synchronized. The Dungeon Master may add
    characterful prose around an accepted reveal but may not invent a clue,
    mark one found, or advance the chapter without its deterministic command.

## 2. Existing implementation boundaries

- `ui/engine.js` owns deterministic movement, range, targeting, attacks, saves, damage, healing, conditions, initiative, and end-state calculations.
- `ui/table-turns.js` owns the human-facing state-machine transitions; `ui/table-automation.js` drives AI Companions and monsters through those same visible phases.
- `ui/table-dice.js` presents exact persisted roll events; `ui/table-combat-narration.js` turns accepted facts into fail-soft cinematic prose; `ui/table-story.js` archives results, synchronizes clients, and recovers authoritative state.
- `ui/table-playback.js` owns GET-only timeline playback and the explicit restore confirmation; it never reconstructs missing board positions.
- `ui/table-voice.js` may play natural server audio only. `ui/table-screens.js` owns My Games, lobby, character library, help, and session controls.
- `lib/multiplayer-guard.js` validates proposed tactical transitions. Campaign, timeline, DM, and media persistence belong to the bounded services in `lib/`.
- `routes/dnd-routes.js` is HTTP composition mounted at `/api/dnd`; it must not become a second rules engine.
- No production source file may exceed 800 executable lines (comments and static text excluded), and no function may exceed 50 executable lines.

## 3. Accounts, campaigns, characters, and seats

### 3.1 Identity and library

- OSHAL authentication supplies immutable `user_sub`; the D&D package does not create a separate password or global “current player.”
- `GET /campaigns` returns every active or archived campaign the user owns or joined, with role, campaign status, seat, scene, updated time, and Resume or Playback action.
- `GET /playback?campaignId=…` is authorized and read-only. It returns exact persisted archive/roll facts, exact boards only for snapshots/current state, and explicit fidelity gaps for beats without a saved board revision.
- A library character (`dnd_characters.campaign_id IS NULL`) belongs only to its account. It may be created manually or imported from supported D&D Beyond PDF/JSON data and must be reviewed before use.
- Starting a campaign copies a selected library sheet into that campaign. Later library edits or deletion do not rewrite an active campaign.

### 3.2 Campaign and lobby lifecycle

- **Start New Campaign** selects exactly four hero sheets, creates a unique six-character join code, and enters a lobby.
- The host must claim one of the four heroes before starting. Any joined guest must also claim one available hero. Unclaimed seats are explicitly labeled **AI Companion**.
- **Start Quest** is enabled with one authenticated host and one claim; it must not wait for four humans or for narration/audio.
- A join code grants access only after an authenticated `POST /join`. An invite contains the code, never credentials.
- One human may claim only one hero in a campaign; one hero may have only one human claimant. Claims lock when play starts.
- **Quit to My Games** closes the table but preserves membership, claim, state, and history. **Resume** re-enters that exact campaign.
- A guest may **Leave Campaign**, releasing the claim and membership; that hero immediately becomes an AI Companion. The host may confirm **Make AI Companion** for an abandoned guest seat through `/campaign/release-seat`.
- Campaign completion and archive status do not delete state. A completed campaign opens in Playback/summary mode and may be duplicated into a new run.

### 3.3 Authority matrix

| Operation | Host | Active hero’s claimant | Other member |
|---|---:|---:|---:|
| Inspect board, story, sheets, inventory, rolls, and read-only playback | Yes | Yes | Yes |
| Move or act for a claimed hero | Only if claimant | Yes | No |
| Drive an unclaimed AI Companion | Automated host presenter only | No | No |
| Drive monsters | Automated host presenter only | No | No |
| Start, advance scene, snapshot, rewind, release guest seat | Yes | No | No |
| Quit to My Games | Yes | Yes | Yes |
| Leave campaign | No | Yes | Yes |

Inspecting another hero highlights or opens its sheet; it never activates that hero’s controls.

### 3.4 Story and investigation lifecycle

- The campaign shelf states genre, premise, investigation count, and battle count before character selection. Starting one campaign never changes another saved campaign.
- A new story-first campaign contains exactly four authored acts: `beginning`, `middle`, `climax`, and `falling-action`. The acts may contain investigation or combat, but a campaign cannot substitute four unrelated encounters for a dramatic arc.
- The beginning establishes ordinary life, desire, disruption, and the party's reason to care. The middle deepens the mystery and changes the party's understanding. The climax resolves pressure created by learned evidence. The falling action answers what changed for the party and its named supporting cast.
- Exploration shows concrete leads as people, places, or objects. Every lead has an authored prompt and exact reveal; locked leads identify that more context is needed without exposing the hidden answer.
- Any seated player may investigate an available lead. The accepted discovery is durable and immediately shared, so two players cannot create conflicting truths.
- Required clue count and prerequisite IDs are content data enforced by the server. Only the host may confirm **Follow the Evidence**, and only after the shared threshold is met.
- Investigation opening and reveal narration uses the same natural-only serialized Story queue as combat. The board never advances merely because audio is missing, and it never starts a second stateful presentation while the current line is playing.
- Named non-player characters retain name, role, personality, motive, and story hook across scenes. Tactical labels such as guard, cultist, or archer remain secondary roles and never replace a person's name.

## 4. Authoritative encounter state

The persisted encounter must expose, directly or by an unambiguous projection:

- `timelineId`, monotonic `rev`, scene and round, initiative order, active actor, and turn serial;
- current phase, movement remaining, action availability, chosen action/target, pending defense, and result event ID;
- every token’s stable ID, kind, grid coordinate, HP/max HP, AC, life state, conditions, and automation/claim label;
- campaign sheet data needed for actions, spell slots, features, inventory, equipment, XP, and level;
- presentation metadata that can recover an interrupted turn without repeating its mechanical effect.

Every semantic phase transition increments `rev`. A client proposes a transition using its expected revision; the server validates identity, claim, active actor, legal delta, phase order, and rules. On conflict it rejects the write and returns authoritative state. The client must replace its optimistic copy rather than merge a rejected branch.

## 5. Deterministic turn resources and resolution

The authoritative resolution loop applies equally to humans, AI Companions, monsters, and downed heroes. Movement and action are simultaneous budgets, not a one-way wizard: a conscious actor may move, act, and spend remaining movement, or act before moving. Target, roll, result, and narration remain ordered once an action is committed.

### 5.1 `ANNOUNCE`

- The turn handoff names the actor without asking a repetitive rhetorical question. A human hears “`<actor>`, the field is yours. Move and act in either order; you may split your movement.” An automated actor receives one brief in-world entrance line.
- The initiative portrait, board token, and fixed turn banner highlight the same actor on every screen.
- The action dock shows that actor’s HP/life state, movement, action availability, key resources, and controller.
- A remote human’s controls are visibly locked with “Waiting for `<player>`.” An AI turn says “AI Companion is choosing” or “Dungeon Master is controlling this monster.”
- Announcement rendering is immediate and cannot wait for `/tts`.

### 5.2 `MOVE BUDGET`

- Legal destinations are outlined in blue and show exact movement cost. Staying on the current square costs nothing; **Attack From Here** makes that legal choice explicit without making it a prerequisite for action cards.
- North is always the top of the board. The compass and grid are fixed across clients.
- Movement supports remaining-speed accounting and difficult terrain. The player may spend it in multiple moves before and after the action.
- Spectators may pan, inspect, and read sheets but cannot select a destination.
- AI movement uses the same engine result and visibly animates from the saved old coordinate to the saved new coordinate.

### 5.3 `ACTION`

- The active sheet’s weapons, spells, class features, items, and legal utility actions are shown as cards.
- Every card shows use type, range/reach, attack or save rule, damage/healing formula, resource cost, and remaining uses/slots.
- An unusable card remains visible but disabled with a reason such as “out of range,” “no level-1 slots,” “action spent,” or “wrong target.”
- A ready action may be chosen before any movement. Committing it records the actor's current square without consuming movement.
- Selecting a card never rolls or applies an effect; it advances to target selection.
- **End Turn** unlocks after the action result is complete. Any unspent movement remains visibly available until the player ends the turn.

### 5.4 `TARGET_DEFENSE`

- Only legal targets highlight. The selected target and intended effect are named in the fixed turn banner and on the board.
- Attacks identify the target AC. Save-based effects identify ability and DC. Healing identifies eligible allies. Area effects show every affected token before confirmation.
- The defender’s response is rules-driven: an attack compares against AC; a save spell rolls the listed save; a special reaction appears only if present and available. The game does not invent a generic defense roll.
- For monster attacks, the hero target and AC/save rule are shown before any die rolls.

### 5.5 `DICE`

- Every rules roll opens the shared dice presentation on every connected screen, including monster, AI Companion, damage, save, death-save, and DM-requested ability rolls.
- A roll event contains a stable `eventId`, actor, purpose, formula, individual natural dice, modifiers, total, DC/AC where applicable, outcome, turn serial, and timeline ID.
- Human-required rolls pause only that deterministic decision until the responsible player presses **Roll**. Automated rolls visibly animate and resolve without asking a human to operate the bot.
- The exact event is persisted idempotently before Apply. Reconnects show the same numbers; no client rerolls an acknowledged event.

### 5.6 `APPLY`

- The engine applies the persisted result exactly once: HP, life state, movement, action, slots/uses, conditions, inventory, XP, and target eligibility update atomically.
- The result card shows natural roll(s), math, hit/miss or success/failure, damage/healing, resource spent, and resulting HP/life state.
- A defeated target remains visible and marked through result presentation; it cannot disappear before players see what happened and cannot return on the next turn.
- Once that persisted result is complete, clearing its action/target cue and advancing initiative must remain legal even when the target is now defeated and therefore no longer targetable.
- The AI Dungeon Master receives the deterministic result as immutable context and cannot change its numbers, target, direction, or consequence.

### 5.7 `NARRATE`

- The saved result is appended to `/archive` before initiative advances. The exact rules result is a visible, replayable, silent ledger beat; the caption contains only cinematic prose.
- Only cinematic `narration`, `milestone`, and `table-talk` beats go to natural text-to-speech. Exact `combat` beats remain available to the shared dice presenter but are never read verbatim.
- Each resolved roll may request one guarded dynamic combat highlight from the campaign Dungeon Master. It cannot issue directives or mutate tactical state, is rejected if the actor or turn changes, and falls back to deterministic prose after a bounded deadline.
- The most recent result/caption stays visible after initiative advances and, if audio plays, at least until that audio ends. Opening/rewind text remains until explicit dismissal.
- Missing, delayed, failed, muted, or blocked audio never holds a presentation gate, input control, state save, or initiative advance.
- AI turns have a minimum visible result dwell of 1.2 seconds, independent of audio, so players can follow them without slowing the rules engine indefinitely.

### 5.8 `ADVANCE`

- Advance occurs only after the mechanical state and required archive event are durable. It selects the next eligible initiative entry, increments the round after wrap, clears per-turn fields, and enters `ANNOUNCE`.
- Automation must stop on a claimed human turn. It may never consume, skip, time out, or act for a connected claimant.
- Victory, defeat, scene advancement, and death-save turns are explicit branches; they are never inferred from narration text.

## 6. AI Companions and monsters

- Exactly one host-side automation presenter holds a short renewable lease. Other screens render only. If it disappears, another host screen may recover the same persisted phase within 20 seconds.
- AI decisions use authoritative coordinates, legal actions, resources, and target rules. The language model does not choose or calculate tactical mutations.
- Automated phases are serialized: movement narration finishes before target/defense, dice finish before the result, and result narration finishes before Advance. Each text phase remains visible for a word-count-based reading minimum; natural playback may extend it only to a 24-second hard deadline. A later actor must never interrupt or displace the current actor's line.
- Each automated movement, target/defense cue, roll, result, and narration is separately visible and persisted. “Acts automatically” is never an acceptable substitute for the action details.
- Automation stops after one actor’s complete turn, reevaluates authoritative state, and then begins the next actor. It cannot run an entire encounter in one unsynchronized loop.
- A failed narration or TTS request degrades to exact captions and continues. A failed state/archive write retries or stops with a recoverable connection message; it never guesses that the action succeeded.

## 7. Life states and party visibility

- `ALIVE`: HP is greater than zero; the token can act normally.
- `DOWN/UNSTABLE`: HP is zero, fewer than three death-save successes, and fewer than three failures; token remains on board and gets a visible death-save turn.
- `STABLE`: HP is zero with three successes or another stabilizing effect; token remains unconscious and visible but does not make further death saves until damaged or healed.
- `DEAD/FALLEN`: three failures or an explicit rules effect; token and party portrait remain visible with a final badge and never re-enter initiative without an explicit restore/rewind.
- Death saves use an unmodified d20: 10+ success, below 10 failure, natural 1 adds two failures, natural 20 restores 1 HP. Every die and counter change is visible to everyone.
- The initiative strip and Party panel always list all four heroes with current HP and one of the above labels. A hidden token must never imply death.
- Defeated monsters are labeled **Defeated**, are not targetable or eligible for initiative, and remain visually distinct from living monsters.

## 8. Inventory, spells, and character sheets

- Anyone at the table may inspect any hero’s full sheet: abilities, saves, AC, speed, HP, actions, features, equipment, inventory, coins, spell list, slot totals/remaining, range, and descriptions.
- Only the active hero’s claimant may consume that hero’s item, slot, or feature. The host automation may consume resources for an unclaimed AI Companion under the same rules.
- Resource consumption is part of the atomic Apply transition and survives refresh, quit/resume, multiplayer sync, rewind, and playback.
- DM-granted loot is validated against a bounded schema, added to both inventory and usable actions when appropriate, archived, and synchronized. Prose alone cannot grant an item.
- Imported sheets are normalized to this display/action contract; unsupported fields produce a review warning rather than silently removing spells or equipment.

## 9. Spatial truth and narration

- Persisted grid coordinates and map metadata are the sole tactical source of truth. Narration directions are derived from coordinate deltas: north/up, east/right, south/down, west/left, with diagonals when equal enough to be meaningful.
- The board always displays a north marker, grid scale, active movement radius, legal squares, target range, and relevant area template.
- `buildSpatialBrief` supplies the DM with the authoritative living-token positions. The DM must correct or omit conflicting historical directions and may not move a token in prose.
- Every client must render the same coordinates at a given `rev`; animation is presentation only and ends at the persisted coordinate.

## 10. Audio contract

- `/tts` is asynchronous enhancement. The table renders captions and unlocks deterministic play before requesting or receiving audio.
- Only allowlisted server-side neural/natural providers may synthesize narration. Browser/device `speechSynthesis`, OS voices, eSpeak-style voices, and any robotic fallback are prohibited for every reason.
- One logical Dungeon Master voice is selected per campaign/session. A fallback provider may be used only when it has an explicitly quality-approved mapping for that same persona; otherwise the table is silent with captions.
- The D&D persona uses Google Cloud Chirp 3 HD Algenib as its configured gravelly primary narrator. OpenAI Cedar may back it up when configured, followed by Gemini Algenib; Kore is never used. Delivery remains slow, intimate, weathered, and grave around danger or death. Bright announcer delivery is not acceptable.
- Every unmuted seated client hears the same newly synchronized authored Story beats through one local serialized queue. Exact combat beats still drive shared dice and remain readable in the ledger, but only their paired cinematic narration is synthesized. A player can explicitly mute an individual device; no second local narration path may overlap or replace that queue.
- The Voice panel names the actual provider/voice, muted/playing/silent state, and offers a natural-voice test. It must never claim audio is active when playback is suspended or no bytes played.
- The Voice panel also persists device-local switches for spoken action declarations, exact dice plus AC/DC narration, and Quick/Standard/Cinematic NPC pacing. Visible dice never depend on the speech switch, and changing pace never changes deterministic rules.
- **Connecting** is reserved for an active synthesis request. An enabled queue with no current request reports **Natural narrator ready**, not a permanent connection attempt.
- TTS timeout, quota, authentication, codec, autoplay, or network failure produces a non-blocking “Natural voice unavailable — captions active” status and a bounded retry. It does not retry with a prohibited voice.

## 11. Save, rewind, recovery, and playback

- A permanent exact-state play mark is captured when each combat round begins, as well as at scene start and major outcomes; the host may create a named manual mark through `/snapshot`. Regenerable images are excluded, while board, story cursor, sheets, inventory, resources, and life state remain restorable.
- Host-only `/restore` atomically restores board, round, sheets, resources, life states, and archive cursor; creates a new `timelineId`; invalidates pending work; and synchronizes every client before play resumes.
- Late state, narration, and roll writes from the abandoned timeline return a stale-timeline error and cannot repopulate discarded history.
- Refresh or reconnect loads `/state`, `/archive`, sheets, roll payloads, and current revision, then resumes the exact incomplete phase without duplicate movement, damage, resource use, or narration.
- Network loss during a proposed action leaves the UI at “Confirming result.” Success resumes from the acknowledged revision; failure restores authoritative state and allows a deliberate retry.
- **Full Playback** is read-only and available at campaign completion. It reconstructs every board revision, turn actor/phase, movement, target, exact roll, result, caption/audio reference, life-state change, scene transition, and ending. It has play/pause, step, speed, and scrub controls and never mutates the campaign.
- Rewind creates a new playable branch; playback only observes a recorded branch. The UI must not confuse the two.

## 12. Security and data integrity

- Every non-public endpoint derives identity from the authenticated request. Client-supplied `user_sub`, owner, claimant, controller, roll result, and host flags are untrusted.
- Every campaign read/write checks owner or active membership. Every tactical mutation also checks expected revision, timeline, active actor, phase, claim, legal movement/action/target, roll linkage, and bounded payload.
- Host powers do not include acting for a guest’s claimed hero. The host must explicitly release an abandoned seat before AI can control it.
- State, snapshot, claim, join, release, leave, archive, and scene-advance races are transactionally serialized. Roll and archive event IDs are unique per campaign and safe to retry.
- DM text and directives are untrusted input: escape rendered text, validate strict schemas and limits, parameterize SQL, authorize generated media, and never execute model-authored code.
- Logs may contain campaign/event IDs and error codes, but never auth tokens, provider keys, imported files, or full private character sheets.

## 13. Responsive interaction contract

- At 1280×720 and above, map, initiative/turn banner, story/result rail, and active controls are simultaneously understandable; the story rail cannot cover movement targets or action cards.
- At 768×1024 tablet size, the map remains primary, the turn banner remains fixed, and story opens as a deliberate drawer that preserves the current turn context.
- At 390×844 phone size, the active actor, phase, HP, movement/action state, and next required tap are visible without horizontal page scrolling. Action cards may use an explicit horizontal carousel.
- TV mode is read-only, fills the available display, shows join/turn/dice/result information, and may be the one speaking device.
- Touch targets are at least 44×44 CSS pixels; keyboard focus is visible; selected, legal, disabled, down, stable, dead, and defeated states are distinguishable without relying on color alone.
- Immersive D&D mode hides unrelated global chat, developer controls, status chrome, and floating developer widgets.

## 14. Executable live acceptance scenarios

All launch scenarios run against the installed package through `http://localhost:35457/cockpit/?app=dnd`, real `/api/dnd/*` routes, a real database, and two isolated authenticated browser contexts. Provider calls may be deliberately failed only in the audio-degradation scenario. No tactical API or database mock is permitted.

Stable test hooks are required for: game menu, campaign row, new game, join code, hero claim, start quest, quit, active actor, phase, controller label, legal square, action card, legal target, defense cue, dice overlay, roll total, result card, life badge, voice status, rewind, and playback controls.

### LA-01 — One-user game starts and yields control

1. Sign in as Host with no active browser campaign and open the app.
2. Assert My Games appears and no table auto-opens; create a campaign with four heroes and claim Bram.
3. Assert the other three seats say AI Companion; press Start Quest with no other account joined.
4. Assert the board enters `ANNOUNCE`, exactly four party portraits remain visible, and the first claimed-human turn exposes legal Position controls within 5 seconds regardless of TTS response.

### LA-02 — Complete human turn is explicit

1. On Bram’s turn, choose one legal square, one enabled attack, and one legal living target.
2. Assert phases appear in order, the move is visible on both browsers, and the action identifies target plus AC/defense before rolling.
3. Assert both browsers show the same natural die, modifier, total, result math, HP change, caption, event ID, and board revision.
4. End the turn; assert the next actor highlights and Bram’s controls lock. Attempt a stale duplicate action and assert rejection with no second damage.

### LA-03 — AI Companion and monster turns are readable

1. Continue a solo campaign until one unclaimed hero and one monster act.
2. For each, assert visible Announce, old/new position or Stay, selected action, target/defense, shared dice, exact result, narration caption, and Advance.
   Assert movement, target/defense, dice, and result occur in that order; each caption remains readable, each available natural line finishes before the next phase, and provider failure releases within the hard deadline without a robotic fallback.
3. Assert no screen contains only “acts automatically,” no living token disappears, and automation stops when initiative returns to Bram.

### LA-04 — Multiplayer ownership and recovery

1. Host creates a lobby and claims Bram. Guest joins with the code and claims Della. Host starts; two remaining heroes become AI Companions.
2. On Della’s turn, assert Guest can act, Host can inspect Della but cannot select her movement/action, and a direct unauthorized `/state` proposal is rejected without a revision bump.
3. Close Guest. Confirm Host cannot act as Della until **Make AI Companion** is confirmed; after release, assert Della’s same saved turn resumes under visible automation.

### LA-05 — All dice are shared and durable

1. Observe a human attack, AI attack, monster attack/save, DM-requested ability check, and a seeded downed hero’s death save.
2. For every roll, assert all connected screens show identical roll payloads before Apply and `/archive` contains one event with that `eventId`.
3. Refresh during a displayed roll/result; assert the same numbers return and the effect is applied once.

### LA-06 — Audio failure cannot stop the game

1. Fail `/tts` with timeout, 401, quota, empty audio, and unsupported playback in separate runs.
2. For each, assert the caption appears, Voice reports natural audio unavailable, and Start Quest, Move, Roll, Apply, End Turn, AI automation, rewind dismissal, and quit remain usable.
3. Assert no call to browser/device `speechSynthesis`, no second narrator, and no robotic audio. Restore a quality-approved provider and assert the natural voice test names the real provider/voice and plays non-empty audio.

### LA-07 — Life states never disappear

1. Put one hero at 0 HP and assert the map, initiative strip, Party panel, death-save counters, and DOWN/UNSTABLE badge remain visible.
2. Resolve success, failure, natural 1, and natural 20 fixtures and assert exact shared dice and rules-correct counters/revival.
3. Reach STABLE and DEAD/FALLEN in separate branches; assert neither hero vanishes and neither takes a normal action. Defeat a monster and assert it is marked and never retargeted or reinserted.

### LA-08 — Inventory, spells, spatial truth, and persistence

1. Inspect every hero from a non-controlling browser; assert sheets are readable but actions disabled.
2. Cast a slotted spell, use an item/feature, receive validated loot, and move through difficult terrain; assert costs, inventory, slots, coordinates, compass direction, and result survive refresh and quit/resume.
3. Assert DM narration uses the persisted direction. Reopen the campaign on both browsers and assert matching revision, positions, resources, HP, and archive.

### LA-09 — Rewind rejects the abandoned future

1. Create a snapshot, complete two turns, and retain one delayed old-timeline archive/state request.
2. Rewind to the snapshot. Assert both browsers replace board, sheets, rolls, story cursor, active actor, phase, and timeline before input unlocks.
3. Release the delayed request; assert stale-timeline rejection and no old damage, narration, die, or initiative state reappears. Continue play successfully from the new branch with or without audio.

### LA-10 — Quit, leave, completion, and full playback

1. Quit mid-turn and assert My Games appears; Resume returns to the same actor and incomplete phase. Guest Leave releases only Guest’s membership and converts that hero to AI.
2. Finish the campaign. Assert final state and all four hero outcomes are clear and Timeline Playback is offered from the summary and My Games.
3. Play, pause, step, change speed, and scrub across persisted moves, attacks, life changes, narration, and scene transitions. Assert rolls/archive text stay exact, boards appear only on exact saved frames, uncaptured-board beats are labeled rather than reconstructed, and no live campaign revision changes.

### LA-11 — Responsive and immersive UI

1. Run LA-02 viewport assertions at 1280×720, 768×1024, and 390×844, plus read-only TV mode.
2. Assert active actor/phase and next action are always visible, story never obscures legal squares or required controls, and the page has no accidental horizontal overflow.
3. Assert 44×44 touch targets, keyboard focus, non-color state labels, and absence of global chat, developer mode, and floating developer widgets.
4. Enter table full screen from inside the game. Assert the cockpit header and
   sidebar disappear, the board relayouts to the available viewport, and Escape
   restores the cockpit without changing campaign state.

## 15. Release gate

The game is “to spec” only when LA-01 through LA-11 pass twice consecutively on the deployed build, once with natural audio available and once with `/tts` unavailable; existing unit, route, governance, and deterministic battle tests also pass; there are no uncaught browser/server errors; and a fresh one-user account can start playing without operator or database intervention.
