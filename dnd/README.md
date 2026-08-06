# Dungeon Master — AI D&D at the table

Lay the tablet flat on the table, gather your party, and play Dungeons & Dragons
with an AI Dungeon Master. The DM narrates the story, runs the battle map, voices
the monsters, and keeps the shared tactical state. On your turn your character
glows: spend movement and take an action in either order, then use any remaining
movement before ending the turn. The game
persists the exact result before the DM dramatizes it, archives the campaign, and
levels the party up.

## v0.19.1 — shared campaigns have a database wall

Released 2026-08-06 America/Chicago by
maintainer@emeraldcoastsystemsgroup.com.

`migrations/006-owner-rls.sql` backfills a nonempty authoritative `owner_sub`
on campaigns, encounters, characters, archive entries, player seats, and
snapshots, then enables and **forces** row-level security on all six tables.
The caller's exact `oshal.current_sub` sees owned campaigns, joined members see
their shared campaign rows, private character-library rows remain visible only
to their exact owner, and the explicit `oshal.is_operator=on` rail retains
operator access. A database-maintained member ACL avoids recursive policies and
cannot be rewritten through ordinary campaign updates.

Join codes are not ambient identity or a permanent bypass. The route accepts
only the six-character hexadecimal format and sets the code as a
transaction-local `oshal.dnd_join_code` capability before the exact active
campaign lookup. Admission, seat capacity, membership insertion, and board
revision commit atomically; rollback clears the capability. Leaving similarly
uses a trigger-local exact-campaign capability only long enough to remove the
derived membership, then access disappears immediately.

The dependency-free contract is `tests/dnd-owner-rls.test.js`. The security
pipeline also runs `scripts/security/run-live-dnd-rls-proof.mjs` against a
disposable PostgreSQL service as a table-owning `NOSUPERUSER`/`NOBYPASSRLS`
role, covering migration replay, two owners, members, join/leave, a stranger,
the operator, and cleanup.

## v0.19.0 - the lead roll lands on the big shared d20

Released 2026-07-31 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

The contested skill check behind an investigation lead was resolved and
narrated, but it was the one dramatic roll in the game that never touched the
shared dice overlay — the server rolled privately and the table read about it.

**A lead tap now opens the big shared d20 every device watches.** The server
persists a `sharedRoll` request carrying the lead's contract — the nominated
hero, the skill it really tests, the DC, and the hero's true skill modifier
(ability plus proficiency, which the DM path's ability-only sheet math cannot
see). The acting player rolls it through the **same `/roll` route** as every
other check, spectators watch the same die land, and the new exploration
`commit-roll` action applies the outcome exactly once — the discovery or the
ledgered miss — while resolving the die **in the same write**. Lead crit
semantics ride the shared die: a natural 20 always finds it, a natural 1 always
fumbles. The requested/rolled/resolved protocol is the only dice path; there is
no parallel rail.

Edges are honest: only one shared roll may pend at a time (`ROLL_PENDING`),
only the roller (or the host, for an AI companion) may commit, a lead someone
else discovered mid-roll resolves the die as a dedupe instead of stranding it,
the muddled escape hatch (whole party failed) still lands without dice, and the
DM narration path refuses lead rolls outright (`ROLL_NOT_NARRATABLE`) so the
storyteller can never resolve a die whose outcome belongs to the investigation.

Guards: `tests/dnd-exploration-service.test.js` (request → land → commit, crit
semantics, commit authorization, dedupe-not-strand) and
`tests/dnd-shared-roll.test.js` (the `/roll` route honors the precomputed
modifier, lead crits, and the narration refusal without ever invoking the
storyteller).

## v0.18.x - conversation is a table truth; motion and art are server truths

v0.18.0 released 2026-07-31, v0.18.1 (bundle metadata only) 2026-07-31,
America/Chicago, by roger.murphy@emeraldcoastsystemsgroup.com.

A live Crownfall session proved two lies: the narrator said heroes moved and
met people while the four PC tokens never left their spawn block, and a whole
investigation chapter produced zero images while the illustrator pipeline sat
healthy. Root cause both times: the walk and the art triggers lived only in
client JS — stale tabs and non-owner devices silently dropped them.

**Every committed narrate exchange now runs through `lib/dnd-story-motion.js`**:
the exchange deterministically matches the person/place/object the fiction
engaged (the player's own words weigh triple the narration; people win ties)
and walks the acting hero beside that figure in an authoritative board write
every device renders via ordinary sync. Reaching a person requests a
first-meeting portrait under a deduped `meet:` key — the first time someone
speaks with Tovin there is a picture of Tovin, and it only ever costs once.
When the last four story beats carry no image, the newest beat is illustrated
(`beat:<archive seq>`, cadence derived from the archive so restores and rewinds
cannot desync it). Combat boards are never touched, and a failed embellishment
never fails the DM reply.

**Discovered leads stand on the map** (`lib/dnd-lead-cast.js`): the person,
place, or object the party found is cast as a real figure at the spot the
acting hero walked to, already-discovered leads reconcile on every action (a
chapter played before figures existed fills itself in), and a person-lead
naming someone already standing on the map must declare `prop:` — a guard that
found nine unlinked leads across three adventures. Stale tabs confess: `/sync`
announces once when the served table code is newer than the page.

## v0.17.0 - a lead is a question put to ONE hero

Released 2026-07-26 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Investigation chapters used to be a row of checkboxes anyone could green-light:
whoever tapped first resolved a clue, the host could tick the whole board alone,
and nothing said which character the fiction would actually send.

**Every lead now nominates a hero.** `ui/leads.js` derives the skill a lead really
tests from its authored type — an object is *investigation*, a person is
*persuasion*, a place is *perception* — then ranks the seated party on ability plus
class training and names one hero. The rogue is sent to the chalkboard, the cleric
to the person, the fighter to scout the roof. Ties break on hero id, so every
device nominates the same character without asking the server. Authors override
per lead with `skill`, `dc`, and `spot`; nothing needed re-authoring, and all 64
existing leads gained a map position for free.

**The table coaxes the right player.** Each lead card says who it is for and why
(`Della · investigation +4`); on that player's device their own leads are lit with
a **YOURS** badge, and the dock tells them which leads are theirs to work. Anyone
else may still take it — but stepping in is a deliberate second tap, not an
accident.

**The server owns the outcome.** `/explore` nominates, verifies the caller
actually plays that hero, rolls the contest itself (d20 + skill vs DC), and
records who found each clue, so the Story log reads *"Della uncovers the Silver
Cup"*. A clue can no longer be resolved by an anonymous caller or an idle
companion. Each hero gets one attempt per lead; a miss keeps the lead open for
somebody else. Once the whole party has failed one it relents, muddled — cold dice
can never deadlock a chapter.

**Investigating is a move, not a click.** The acting hero walks to the lead's spot
on the map before it resolves.

Guards: `tests/dnd-leads.test.js` (35 checks — skill inference, nomination ties,
deterministic spots, the contested roll) plus service cases for the nomination
refusal, hero theft, one-try-each, and the deadlock escape hatch.

## v0.16.1 - the whole campaign shelf fits

Released 2026-07-23 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

The visual campaign shelf now overrides the narrow legacy form-dialog limit.
Chromium checks at 1440Ã—900 and 390Ã—844 show all five campaign cards in one
intentional internal scroller, with two desktop columns, one phone column, no
clipped card controls, no page-level horizontal overflow, and no browser errors.

## v0.16.0 - choose a story, investigate it, earn the climax

Released 2026-07-23 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

**Start New Campaign** now opens a visual campaign shelf. The original Coast
Road rescue remains available beside four original four-act adventures:
**The Crownfall Masquerade**, **Bells Beneath Blackwater**, **The Astronomer's
Last Night**, and **The Road of the Last Lantern**.

Each new campaign has a beginning, middle, combat climax, and falling action.
The party is the protagonist. Named, quirky people carry motives and memory;
searchable people, places, and objects reveal shared authored evidence; dependent
leads unlock only when the party has learned enough. The host follows the
evidence into the next chapter only after the required discoveries, so a mystery
cannot silently skip to a fight.

The campaign stories cover royal-tournament intrigue, rain-soaked coastal horror,
an impossible observatory mystery, and an original fellowship journey. Each
scene has themed illustrated map art. Rules, turns, visible dice, natural-only
voice, multiplayer claims, saved campaigns, timeline playback, and rewind remain
the same deterministic table underneath every setting. Every combat round also
creates a permanent image-free play mark, so a failed route can be restored
without replaying hours merely to reach the same decision.

## v0.15.4 - the story finishes before the turn advances

Released 2026-07-23 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Ordinary multiplayer synchronization no longer stops the narration already
playing. Stateful turn presentation now waits for that natural voice line to
finish before automation advances, while a bounded voice watchdog still releases
the table if the provider or player fails. The toolbar visibly reads **DM
Speaking · Settings** throughout playback.

A human hero may spend remaining movement while the Dungeon Master describes
the action they just completed. End Turn stays locked until the story line is
finished, preventing the next actor from talking over it.

Identical state returned by a DM conversation no longer cancels an in-progress
die or result presenter. If a death-save presentation is genuinely interrupted,
it retries after its stale job retires instead of leaving initiative stranded.
The death-save result also separates failures already recorded before the d20
from failures added by that roll.

## v0.15.3 - timeline always has a way home

Released 2026-07-23 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Timeline Playback now keeps **Return to Game** in its visible header at every
supported viewport. The existing footer action remains available when visible,
and leaving playback remains read-only: it does not restore, rewind, or reset the
campaign.

## v0.15.2 - attack from here, move afterward, tune the DM

Released 2026-07-23 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

**Attack From Here** makes standing still an explicit legal choice. A completed
attack now releases any movement still shown in the turn budget even if the
browser retained a stale presentation latch, so move-attack-move and
attack-move both remain usable without refreshing or resetting the campaign.

The Voice panel now controls gameplay presentation as well as mute/test:
spoken action declarations, optional exact dice plus AC/DC narration, and
Quick, Standard, or Cinematic NPC pacing. Dice remain visible regardless of
the speech setting, and results and story narration remain authoritative.

## v0.15.0 - real turn budgets, named cast, darker storyteller

Released 2026-07-23 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

The false linear **Move done → Choose → Target → Roll → Result** checklist is
gone. The turn row now counts down movement, the one action, spell slots, and
health at the same time. A player may move then act then move again, or act
first and spend movement afterward; the multiplayer guard verifies both orders.

Recurring foes and story characters now have persistent proper names, roles,
playable mannerisms, and continuity hooks. Existing saved campaigns resolve
their old generic token IDs through that authored cast without resetting the
board. Roles such as **Camp Guard** remain subtitles rather than names.

Google Cloud Chirp 3 HD Algenib is the configured D&D narrator: gravelly,
restrained, and suited to dark folklore. OpenAI Cedar may back it up when
configured, followed by Gemini Algenib. Kore, browser speech, and device speech
are prohibited.

## v0.14.9 - the whole game in one view

Released 2026-07-23 00:10:04 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Full-screen play now opens one vertically navigable right rail containing the
active character, honest ready actions, carried items, the current quest, latest
story, suggested actions, and a pinned **Ask DM** input. The full-screen control
is deliberately prominent; browser full screen removes cockpit chrome, while an
in-table focus mode remains usable if the browser blocks that permission.

Every ordinary DM conversation now receives the current timeline's recent story
history. Later events override the opening premise, so returning to the cart
cannot make a freed merchant missing again or silently restart an encounter.
When the party circles, the DM must distinguish established clues from unresolved
questions and offer genuinely different ways forward.
The pinned quick questions ask what is known, what remains searchable, or how to
get unstuck without pretending that a player question was an in-world action.

The opening supplies round-one art, every later combat round requests one
illustration, and confirmed defeats request an additional kill tableau. Stable
event identities deduplicate concurrent players and reconnects before provider
work, so one story event creates one paid image. Completed art appears directly
on the requesting table and remains in the shared story archive.

## v0.14.8 - know what your character can use

Released 2026-07-22 23:30:56 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

The action dock now shows only resource-ready choices for the active player.
Spent spells move into a clear summary naming the unavailable spells and why.
Fenwick at zero level-one slots therefore sees Fire Bolt and Dagger as choices,
with Magic Missile and Burning Hands labeled **SPENT — No level-1 slots
remaining** rather than behaving like selectable actions.

The backpack button and every hero portrait now open a full-game-surface
character view. It separates **Available right now** from **Full potential** and
shows current/max spell slots, HP, AC, speed, condition, ability scores, action
and spell details, actual inventory/equipment, coins, and features. A Chromium
visual pass at 1440×900 confirms one internal content scroller, fixed identity
and return controls, and explicit spent styling.

## v0.14.7 - one My Games scrollbar

Released 2026-07-22 23:23:32 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

My Games now keeps its heading and actions fixed while only the campaign list
scrolls. The outer card no longer creates a second scrollbar. A Chromium visual
render at 1440×900 with twelve campaigns confirms exactly one scrollable element.

## v0.14.6 - the quest survives the fight

Released 2026-07-22 23:04:49 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

The current quest is now pinned above the Story ledger and its opening can be
heard again at any time. Every Dungeon Master request carries the scene's
authoritative throughline, so the missing merchant, boot print, smoke, ambush,
and later ravine rescue remain part of the story during combat.

Stationary companions no longer repeat filler. Automated handoffs and attack
cues vary; Second Wind is described as recovery instead of Bram attacking
himself; and Pip nocks an arrow on the bow already in hand. Each new round gets
a concise story highlight, and every second round requests a fresh cutaway
without changing or blocking the deterministic combat result.

The table now has a **Full Screen** control. It expands the game surface over the
cockpit header and sidebar; press Escape or **Exit Full Screen** to return.

## v0.14.5 - live conversation stays open during combat

Released 2026-07-22 22:50:00 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Player questions now use a dedicated story lane, so an optional cinematic combat
highlight cannot make the Dungeon Master report that the table is busy. The live
storyteller deadline is 30 seconds, with a 35-second browser window; this covers
the measured 10–18 second Codex responses instead of discarding successful
answers at eight seconds. Optional combat prose remains capped at eight seconds
and still falls back to deterministic narration without delaying the rules loop.

If a live reply cannot be delivered, the Story rail now shows the recoverable
server reason instead of replacing it with a generic silence message.

## v0.14.4 - the Dungeon Master tells the fight, not the spreadsheet

Released 2026-07-22 22:19:02 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Combat now has two deliberate layers. The combat record retains the exact actor,
action, target, dice, modifier, defense, damage, and result. That rules ledger is
visible and replayable, but it is never sent to text-to-speech. Movement and
attack intent use brief cinematic prose, and each resolved roll receives a
guarded one- or two-sentence highlight from the campaign's active Dungeon Master.
If the storyteller is unavailable or the board changes, deterministic prose takes
over without changing or delaying the saved result indefinitely.

Automated turn announcements no longer ask repetitive questions such as “What
will Snaggletooth do?” Human handoffs name the character and directly explain the
Move choice. Every newly synchronized live beat now presents in sequence, so an
authored narration beat can no longer hide the exact shared die that preceded it,
and a later action cannot silently replace an earlier spoken line.

## v0.14.3 - Story voice and initiative handoff recover together

Released 2026-07-22 21:59:59 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Every seated client now sends each newly synchronized live Story beat through the
same natural-only narration queue used by combat. The voice display says
**Connecting** only while synthesis is actually in progress and says
**Natural narrator ready** while idle.

Completed automated turns now clear their persisted target and advance even when
the action defeated that target. The server no longer rechecks a dead defender as
though it still had to be a legal living target, so the table cannot loop on a
completed AI result or repeatedly swap visual focus while retrying a rejected
advance.

## v0.14.2 - every automated turn is readable

Released 2026-07-22 10:10:58 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

AI Companions and monsters now serialize movement, target/defense, visible dice,
and result narration instead of advancing on fixed 600-900 ms timers. Each line
gets a text-length-aware reading window and, when natural audio is playing, waits
for that line to finish before the next phase. A 24-second hard deadline keeps a
blocked browser or failed provider from freezing the table. Repeated action cues
are suppressed so the voice cannot fall behind and skip forward through a queue.

This is an OSHAL **app package** (ADR-085): it installs into a swarm and hot-loads
— nothing is compiled into the core image.

## v0.14.1 — monster movement honors terrain cost

Released 2026-07-22 01:59:22 America/Chicago by
roger.murphy@emeraldcoastsystemsgroup.com.

Automated monsters now choose destinations from the same Dijkstra movement-cost
map enforced by the server. Difficult terrain, blocking detours, spent feet, and
remaining movement stay identical on both sides, so a rejected movement can no
longer reset and retry the same monster turn indefinitely.

## v0.14.0 — the complete tabletop loop is explicit

Every combatant now advances through the same visible, server-guarded sequence:
the Dungeon Master names the actor, the actor moves or stays, chooses an action,
selects a legal target, shows every exact die and defense, presents the saved
result, and only then advances initiative. A signed-in player controls only their
claimed hero; unclaimed heroes run as clearly labeled AI Companions while every
character sheet and inventory remains inspectable.

The accountable story bot now uses the package's exact Dungeon Master persona on
the OpenAI Codex runtime. Generated prose is optional color around deterministic
rules: it is deduplicated, time-bounded, rejected when the board has moved on, and
cannot silently roll, move, damage, or advance a turn. Campaigns open through My
Games, can be quit without leaving, and have read-only timeline playback with
honestly labeled board gaps and a separate confirmed Restore / Rewind action.

Natural narration is enabled for every player unless that player explicitly
mutes it. The server tries Google Cloud Chirp 3 HD Algenib, then OpenAI Cedar
when configured, then Gemini Algenib; it never uses Kore or browser/device speech. If browser autoplay blocks
otherwise valid audio, the exact fetched narration and caption wait behind a
clear **Tap Listen** state and resume on the next gesture without another paid
synthesis request.

## v0.13.4 — solo games recover instead of waiting on narration

Live initiative now resumes before the optional “Previously on…” recap is
generated or spoken. Automation presenter identity survives a same-tab refresh,
and a truly abandoned browser lease expires in 20 seconds instead of two minutes.
The host no longer sees a false-enabled Skip Monster button while exact movement
is still recovering. Suspended Web Audio is never reported as audible, and a
transient natural-voice outage retries after ten seconds without enabling any
device or robotic substitute.

## v0.13.3 — every shared turn is visible and recoverable

The table now enforces one readable loop for humans, AI Companions, and monsters:
the Dungeon Master names the actor, the board shows Position, the actor chooses an
action and target, every exact die appears, the saved result is narrated, and only
then can initiative advance. Unclaimed heroes act as visible AI Companions and the
host can deliberately convert a disconnected guest's hero back to AI control.

Opening scenes and rewinds are shared presentation gates, so no device can move or
roll while the Dungeon Master is still setting the moment. Rewind replaces the
abandoned story, cursor, dice memory, and board branch on every client before play
resumes. Required combat history retries through transient connection failures and
late pre-rewind posts are rejected instead of repopulating discarded history.

Narration is natural-provider-only: Google Cloud Chirp 3 HD Algenib is the
configured gravelly primary, OpenAI Cedar is tried next when configured, and Gemini Algenib is the final natural
backup. Unavailable audio means captions plus silence—never a browser or device
voice.

## v0.13.2 — OpenAI natural narrator and browser boot fix

Narration now uses OpenAI `gpt-4o-mini-tts` through the platform provider with
the gravelly Algenib voice at a slower pace. Identical lines share a bounded server
cache so multiple listeners do not multiply synthesis charges. The split
classic scripts are also declaration-tested in one shared browser global.

## v0.13.1 — natural narrator deployment fix

The table now selects the stack's configured Gemini natural server narrator and
migrates stale browser voice choices away. If natural audio is unavailable, the
game remains silent with captions; it never substitutes a browser/device voice.

## Open and test locally

With the canonical local OSHAL stack running, the DND package installed, and
`APP_PACKAGE_DYNAMIC_ROUTES=1`, sign in and open:

**[http://localhost:35457/cockpit/?app=dnd](http://localhost:35457/cockpit/?app=dnd)**

That opens **My Games**; signing in never resumes a campaign by itself. The table
route is `/api/dnd/table`, but the cockpit URL above is the normal entry point
because the package requires an authenticated OSHAL user and context.

For a two-player smoke test:

1. The host chooses **Start New Campaign**, selects exactly four heroes, creates
   the multiplayer lobby, and claims one hero.
2. From the lobby, copy the six-character code or **Copy Invite Link**.
3. The second player signs in to the same OSHAL deployment on their own browser
   or device, opens Dungeon Master, chooses **Join with Code**, enters the code,
   and claims one available hero. An invite link prefills the same code.
4. After every joined person has chosen a hero, the host chooses **Start the
   Quest**. Any of the four heroes nobody claimed is clearly labeled **AI
   Companion** and is run by host-side automation.

Use separate signed-in accounts when checking control boundaries: each person
can inspect every character sheet, but can act only for the hero they claimed.
Claims lock when the quest starts.

## Campaigns and characters

- **My Games** lists every campaign the signed-in user hosts or has joined.
  **Resume** opens that saved table; **Start New Campaign** creates another one.
- **Quit to My Games** closes the active table on that screen while preserving
  the campaign, story, and seat for a later Resume.
- **Leave Campaign** is the non-host participant's deliberate exit. It releases
  that player's seat and claim; their hero stays in the party as an AI
  Companion. It does not delete the host's campaign or story.
- **Party & Join Code** lets the host recover from a disconnected participant.
  After confirmation, **Make AI Companion** releases that guest's seat, keeps the
  hero and campaign history, bumps the shared table revision, and resumes the
  hero under visible host-side AI automation. Waiting lobby guests can be removed
  the same way.
- **My Characters** is an account-level library. Import a D&D Beyond PDF export,
  a supported JSON sheet, or enter the essentials manually. PDF extraction is
  best-effort, imports are processed by the OSHAL server, and the player should
  review the resulting sheet before the quest begins.
- Starting a game copies a saved character into that campaign. The library
  original remains reusable, and deleting it later does not change campaign
  copies already made.

## What happens on a turn

The green turn row and the Dungeon Master name the active hero or monster. A
player who does not control that hero can still inspect its sheet and skills,
but those actions are view-only on that device.

For a claimed hero, movement and action are simultaneous budgets:

1. **Move and/or act** — tap **Move** to reveal outlined blue legal destinations
   and their exact costs, or choose an enabled weapon, spell, or feature first.
   Movement may be split before and after the action.
2. **Target or roll** — choose one of the highlighted legal targets. If the DM calls for an ability check,
   the shared roll pauses play until the responsible player rolls; everyone sees
   the same saved natural roll, modifier, and total.
3. **Exact result and Story** — the attack/save math and outcome are saved and
   shown before the DM narration completes. Only then can play advance. If
   movement remains, the hero may use it before **End Turn**.

Enemy defenses follow the action: an attack normally compares against Armor
Class, while some spells call for the listed saving throw. The game does not add
a separate player defense roll to every attack. Monsters and AI Companions show
their readable movement, action/target, exact result, and Story events;
the host screen performs their automated turns instead of letting them silently
skip through initiative. A downed hero remains on the board and must resolve the
displayed death save on that hero's turn.

Outside tactical combat, the Story rail can offer three suggested paths, or a
player can talk to the Dungeon Master in their own words. During combat, those
story choices are suppressed so they cannot be confused with the active hero's
legal actions.

## Timeline playback, saves, rewind, and narration voice

The Dungeon Master creates automatic save points at key beats, and the host can
make a manual save from **Timeline Playback**. Playback is read-only: archive
beats and persisted rolls are shown exactly, while token positions appear only
on exact saved-board frames. Archive-only gaps are labeled instead of
reconstructing positions. **Restore / Rewind** is a separate host-only action
with a second confirmation because it creates a new playable branch from the
selected snapshot and replaces later current-branch story.

Read-aloud narration has one strict rule: a voice-enabled screen plays natural
server audio from `/api/dnd/tts`, or it stays silent while the captions remain
visible. Google Cloud Chirp 3 HD Algenib is tried first, OpenAI Cedar second when
configured, and Gemini Algenib third. The actual narrator is named on screen. The app never falls
back to browser or device text-to-speech. If every provider is unavailable, the
Voice control reports that state and the game remains caption-only. Every player
hears narration by default; mute is an explicit local preference. Browser
autoplay denial is shown as **Tap Listen**, not a false provider outage, and the
already-fetched audio is retained for that gesture.

## v0.13.0 — every turn tells a story

- **No more invisible auto-run.** Companion and monster turns stop at visible
  Position → Choice/Target → Exact Result → Story phases. Each phase is spoken
  or held long enough to read, and initiative cannot advance until the result
  has been saved and narrated.
- **Heroes go down; they do not disappear.** A hero at 0 HP remains on the map
  with a large DOWN marker, visible success/failure counters, and a blocking
  unmodified death-save roll on that hero's turn. Healing can bring them back;
  only three failed saves mark them fallen.
- **The board is the source of truth.** DM prompts now include exact grid
  coordinates and the screen compass, so narration cannot call an enemy north
  when it is east. Enemy targets remain highlighted through synchronized
  telegraphs on every player's screen.
- **Story and voice are paced safely.** Tactical results are archived for every
  player before the next turn. The selected neural voice is retried once and
  then the game stays caption-only—never a robotic browser substitute. Rolls
  submit automatically and keep their exact result if the DM reply is
  interrupted.
- **Old saves explain what happened.** Finished battles made under the previous
  immediate-removal rules open with a standing/down/fallen summary instead of
  silently resuming automation. Concurrent story posts and scene advancement
  are serialized so beats and XP cannot be skipped or duplicated.

## v0.11.0 — everyone knows when and where they can act

- **A real multiplayer lobby.** The host chooses four heroes and shares the
  six-character join code. Every signed-in player claims one character before
  the host starts the quest; seat changes stay synchronized across phones and
  the TV.
- **Clearly labeled AI companions fill empty seats.** Every unclaimed hero is
  marked as an AI Companion and takes a visible movement/action turn on the
  host device. Human players can inspect the whole party but control only the
  hero they claimed.
- **An unmistakable turn row.** A reserved row always names the active hero or
  monster and shows movement remaining, whether the action is still ready, and
  when to end the turn. The DM announces each turn aloud; a claimed player is
  guided through **Move or Stay Here → Action → End Turn**, while everyone else
  sees that hero's locked skills. Only the player who claimed the active hero
  can submit that turn; stale simultaneous updates recover to the authoritative
  board.
- **Legal movement you can read.** Every reachable destination is outlined in
  blue and labeled with its movement cost. Movement can be split across several
  taps, difficult terrain costs extra, and the remaining feet update after each
  step.
- **Character sheets and inventory.** Tap a hero, initiative portrait, or the
  backpack in the action dock to inspect abilities, gear, equipped weapons,
  coins, features, and spells. DM-granted loot is persisted and synchronized to
  every player.
- **Bring your own character.** Upload a D&D Beyond PDF export or supported JSON
  sheet, or use the quick essentials form. Imports are normalized and validated
  on the local OSHAL server before they can join a campaign. PDF extraction is
  best-effort, so the quick form remains available for flattened or unusual
  files.
- **Story never hides the tactics.** Narrative suggestions are suppressed while
  combat is active, and the story drawer no longer covers movement or action
  controls.
- **Readable enemy turns.** Enemies have distinct labels, telegraph their target,
  action, and defense check before resolving, and then show the attack/save math.
  Defeated tokens leave active play instead of resembling the next goblin.
- **An invite link, not just a mystery code.** The lobby explains the three join
  steps and copies a signed-in deep link with the code prefilled.

## v0.5.0 — choose-your-path

At story decision points outside tactical combat, the Dungeon Master offers
**three tappable choices** (a bold one, a clever one, a cautious one). Tap one and
the DM narrates the consequence and offers three more, so the narrative branches
like a game. You can always ignore them and **talk to the DM in your own words**
instead. Scene openings ship three bundled choices (instant, no wait); the DM
generates fresh ones after that (`CHOICES: a | b | c`, parsed server-side and
stripped from the story log).

## v0.4.0 — the cinematic surface (a TV show you play)

The board is no longer tokens on a grid. It's a **painted battle map** with
**AI-generated character-portrait tokens**, and it *moves*:

- **Real portraits, not checkers** — every hero and monster is a painted bust
  (generated once via the `media-generation` skill, downscaled, and bundled as
  `data/tokens/*.png`); each scene has a painted top-down battle-map background
  (`data/maps/*.jpg`). The whole art pack is ~1.7 MB.
- **It's animated** — a single `requestAnimationFrame` loop drives smooth token
  glide, a lunge-and-impact on attacks, floating damage/heal numbers, HP rings,
  an active-turn spotlight, drifting embers, and per-element spell VFX (fire
  cones, force streaks for Magic Missile, radiant beams, healing sparkles, weapon
  slashes).
- **DM voiceover captions** — the DM's narration fades in as a cinematic
  lower-third over the scene (and is read aloud), biggest on the TV.
- **The rules moved to a tested engine.** All the game math (dice, movement,
  targeting, combat, saves, cone AoE, initiative, monster tactics, end-state,
  level-up) now lives in `ui/engine.js` — the *same* module the live surface runs
  and `tests/dnd-engine.test.js` exercises. That suite plays **400 full auto-run
  battles** (88% party win rate, zero stalemates) plus deterministic unit cases
  for every rule. The served page embeds that shared engine followed by the six
  ordered tabletop sources listed below.

## v0.3.0 highlights

- **The board on the TV, the game in your hands.** Open the app with `&mode=tv`
  (or the **TV Mode** ribbon tile) on any signed-in TV browser: the battle map
  fills the screen, the join code sits in the top bar, and the TV is the table's
  voice — it reads every DM beat aloud while players move their heroes from
  their phones. The TV never writes the board; it follows the live game and even
  waits patiently ("Waiting for a game to start…") if you turn it on first.
  *(The dedicated Fire TV stick app is hardwired to the Jarvis home today — a
  clickable launcher chip there is a tracked core follow-up; any TV browser
  works now.)*
- **A two-chapter campaign arc.** Win the Coast Road ambush, then **Press On →**
  into *The Ravine* to rescue the merchant. `/advance` awards the scene's XP
  (combat + DM story award) to the campaign's **persisted** characters, applies
  real SRD level-2 deltas (`data/srd-leveling.json`: HP, new slots, Action
  Surge, Divine Smite, Hunter's Mark…), and rebuilds the next board **from the
  leveled sheets**.
- **Cone spells sweep the arc.** Burning Hands is a true 15-ft cone: aim at an
  enemy and everyone in the arc rolls a save — half damage on a success.
- **AI cutaway art.** At story milestones (scene openings, victories) the host's
  device asks the imaging pipeline (`media-generation` kernel skill) for one
  cinematic illustration; it fans out to every device via the story archive and
  takes the stage — biggest on the TV. Fail-soft: no provider configured means
  no art and an uninterrupted game. Cost is stamped to the ledger when the
  provider reports it.
- **Prop tokens** — the bound merchant stands on the ravine board; part of the
  scene, never in the initiative order.

## What's in the box (v0.1.0 — the playable slice)

- **A fun Dungeon Master bot** — an accountable OSHAL bot node (`dungeon-master`,
  persona in `personas/`) that narrates, free-talks ("I ask the guard what
  happened"), calls for checks, and turns dice results into cinematic beats.
  Reasoning runs on the bot (ADR-036); cost is auto-tracked to `chat_tasks`.
- **The tabletop surface** (`ui/table.html`) — a canvas battle map with the full
  turn loop: initiative order, active-character highlight, tap-to-move with a
  movement radius over difficult terrain, weapon/spell action bar with range +
  spell-slot tracking, attack rolls vs AC, saving throws, healing, sneak attack,
  crits, and a simple goblin AI that closes, flanks, and routs when the boss falls.
- **"Talk to the Dungeon Master"** — free-text or voice (browser speech input) at
  any time; the DM reads its narration aloud (toggle 🔊).
- **A pre-generated party of four** (Fighter, Life Cleric, Wizard, Rogue) and a
  starter one-shot, **Ambush on the Coast Road** — playable immediately, no import
  needed.
- **Per-user campaign persistence + story archive** — every campaign, board, and
  narrative beat is saved under your account (`migrations/001-dnd.sql`), while
  `migrations/006-owner-rls.sql` forces the database to enforce exact owner and
  shared-member access independently of the route filters.

## Open content

All rules — monsters, spells, weapons, class numbers — come from the **D&D System
Reference Document 5.1**, released by Wizards of the Coast under **CC-BY-4.0**. No
proprietary Wizards content ships here. See [`data/LICENSE-SRD.md`](data/LICENSE-SRD.md).
"Dungeons & Dragons" is a trademark of Wizards of the Coast; this is an unofficial,
independent work.

## Layout

```
dnd/
  oshal-app.yaml                     # the package definition (suite: ai-creative)
  personas/dungeon-master.yaml       # the DM (extends dnd-foundation)
  personas/dnd-foundation.yaml       # open-content rule + table safety + response contract
  routes/dnd-routes.js               # serve surface, content, state, playback, archive, DM calls
  lib/                               # campaign, timeline, media, import, and route services
  ui/table.html                      # CSP-safe shell; route embeds the sources below in order
  ui/engine.js                       # shared deterministic tactical rules
  ui/table-runtime.js                # state, canvas, input, and common helpers
  ui/table-voice.js                  # fixed natural narrator chain and audio lifecycle
  ui/table-dice.js                   # exact persisted initiative/action roll presentation
  ui/table-presentation.js           # shared opening and rewind narration gate
  ui/table-turns.js                  # turn orchestration
  ui/table-automation.js             # visible AI Companion / monster phases
  ui/table-outcomes.js               # victory, defeat, downed, and death-save outcomes
  ui/table-story.js                  # archive, shared checks, saves, and synchronization
  ui/table-seats.js                  # host-only disconnected-seat recovery controls
  ui/table-playback.js               # read-only archive/roll/snapshot timeline and restore gate
  ui/table-screens.js                # My Games, lobby, character library, help, and controls
  ui/dnd.css                         # dark, lay-flat-on-the-table styling
  data/party.json                    # pre-gen party (SRD-derived)
  data/srd-monsters.json             # SRD bestiary (goblin, goblin boss, wolf)
  data/adventure-goblin-ambush.json  # the starter one-shot (original; uses SRD creatures)
  data/LICENSE-SRD.md                # CC-BY attribution
  migrations/001-dnd.sql             # campaigns, encounters, characters, and archive
  migrations/002-multiplayer.sql     # seats, claims, and shared revisions
  migrations/003-snapshots.sql       # Timeline & Rewind snapshots
  migrations/004-character-library.sql # reusable account-level characters
  migrations/005-roll-events.sql     # exact, idempotent dice payloads for shared playback
  migrations/006-owner-rls.sql       # owner backfill, member ACL, and forced RLS
```

## Roadmap (next increments)

Tracked so this stays honest about what is and isn't built:

1. **Extract a game-neutral tabletop runtime after the D&D release.** Preserve
   the proven session, seat, turn, shared-roll, story, media, and rewind loops
   behind a versioned `GameDefinition` plus rules/narrator adapters. D&D remains
   the first ruleset pack; character import, death saves, spells, and goblin
   tactics stay in that adapter instead of leaking into the generic core.
2. **Richer end-of-game replay and export.** The shipped baseline offers
   authenticated read-only play/pause, step, speed, selection, and scrubbing
   across persisted archive/roll facts plus exact snapshot and final-board
   frames. The next increment persists every board revision and cutaway link so
   currently labeled board gaps can become a continuous visual replay and a
   shareable recap. Restore remains a separate confirmed playable branch.
3. **Per-character voices (hardened men, ethereal women).** Operator direction
   (2026-07-20): the narration should match the period — a gravelly, weathered
   Dungeon Master, and distinct voices when he speaks *as* NPCs (ethereal for the
   women, grim for the brutes). The server voice abstraction accepts an exact
   natural voice per call, so DM speaker tags plus an allowlisted voice map are
   buildable; today the fixed Algenib-first natural narrator chain reads every
   speaker, and the 🔊 button shows its real provider status.
4. **Always-on table mic → the DM weaves the room into the story.** Operator
   idea (2026-07-20): with everyone signed in on their own phone, each phone is a
   naturally speaker-attributed mic — record table talk (opt-in), run it through
   the swarm STT, and let the DM fold what players *say at the table* into the
   narration and match voices to characters. The rails exist (STT provider
   registry, per-user sessions); needs explicit consent UX before building.
5. **Location-based campaign packs.** Let a game definition map encounters onto
   a consenting player's real region and use licensed/public terrain, imagery,
   or LiDAR-derived geometry to build local adventures. Done means location is
   coarse by default, private homes and live player positions are never exposed
   to strangers, every data source has recorded provenance, and the same pack
   can fall back to a fictional map when real-world data is unavailable.
6. **More generated battle maps** — two bundled painterly scene backgrounds and
   milestone cutaways ship today; generating and caching arbitrary encounter
   maps remains open.
7. **Deeper spellcasting** — sphere templates (fireball), concentration,
   conditions, reactions (cones shipped in v0.3).
8. **Level 3+ and a longer campaign arc** — My Games already provides the
   multi-campaign library; higher-level deltas and more connected scenes remain
   open.
9. **Fire TV stick launcher** — the paired-stick APK loads the Jarvis home only;
   add a clickable app chip there (core `tvView()` change) so the board is one
   D-pad click away. Any signed-in TV browser already works via `?mode=tv`.
10. ~~**RLS hardening.**~~ **Shipped in v0.19.1** — migration 006 backfills
   authoritative owners, maintains the shared-member ACL in database triggers,
   forces RLS across all six tenant tables, keeps private character libraries
   exact-owner only, and bounds join/leave admission with transaction-local
   capabilities. The disposable PostgreSQL proof runs in the security pipeline.
11. ~~**Draw the leads on the map.**~~ **Shipped** across v0.17.x–v0.18.0:
   discovered leads are cast as real figures (`lib/dnd-lead-cast.js`), the
   acting hero visibly crosses to them (an authoritative board write, not a
   client animation), and already-discovered leads reconcile on every action.
   Still true to the original ask's spirit but narrower: *undiscovered* leads
   deliberately have no board presence — a clue not yet found is not on the map.
12. **Many more cutaways.** The operator's ask was roughly nineteen times the
   v0.17.0 cinematic density. Shipped so far: per-discovery and chapter-complete
   art (v0.17.0), first-meeting portraits under a deduped `meet:` key and the
   every-fourth-story-beat cadence (v0.18.0) — all keyed so replays never
   regenerate art. Still open: the big combat beats (a natural 20, a natural 1,
   first blood, a hero dropping, a level-up, a boss reveal), cheap local
   transitions for the common beats, and a per-campaign cap.
   **Done when:** those beats each request a keyed cutaway, local transitions
   cover the common ones, generated art is reserved for the big ones, and a
   per-campaign cap is enforced and visible. (Budget math: generated art is
   about $0.04 per image, so ~20 beats is under a dollar a session — the cap
   exists to stop a runaway, not to ration the drama.)
13. ~~**Put the lead roll on the big d20.**~~ **Shipped in v0.19.0** — a lead
   attempt opens the shared d20 for the acting player, every device watches it
   land via the requested/rolled/resolved protocol, and the exploration
   `commit-roll` action applies the outcome exactly once. See the v0.19.0
   changelog entry above.

## Dev notes

- Package routes mount only when the swarm has `APP_PACKAGE_DYNAMIC_ROUTES` on.
- The surface fetches everything from `/api/dnd/*`; dice and tactical math run
  client-side for instant, tactile play. Narration + persistence go to the server.
- Run focused engine and browser-contract checks from this package with
  `node tests/dnd-engine.test.js` and `node tests/dnd-ui-contract.test.js`.
- Validate before publishing: `node scripts/oshal-app.js validate dnd` (from the
  OSHAL repo).
