/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 03:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Regression guards for two defects found by LIVE play, not unit tests: (1) the host answering a "spoken" mode with a full markdown document (headings/tables/bullets/emoji) that would wreck the caption bar and blow the TTS limit; (2) host data replies needing tolerant JSON extraction. Plain `node tests/host-guards.test.js`.
 * 2026-07-31 23:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #4 guard: the FIRST round start auto-dispatches exactly one 'intro' spoken line (applied as the room caption, so the speaker surface voices the open with the titles), a later round start never re-narrates it, and the ▶ response returns without waiting on the intro round-trip.
 */

'use strict';

const { createHostService, spokenText, extractJson, SPOKEN_CONSTRAINT } = require('../lib/host-service');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

// ── The ACTUAL reply that broke the caption bar in live play (2026-07-22) ────
const REAL_BAD_OUTRO = [
  '# 🎉 THAT\'S A WRAP, FOLKS! 🎉',
  '',
  '---',
  '',
  '*The lights swirl, the confetti drops!*',
  '',
  'Well, what a morning we had here on **Family Feud**!',
  '',
  '📱 **Check their phone** — 28 points up top!',
  '🚽 **Use the bathroom** — 22!',
  '',
  '| | Team A | Team B |',
  '|---|---|---|',
  '| **Final Score** | 0 | **50** 🏆 |',
  '',
  '### 👑 TEAM B — YOU ARE TODAY\'S CHAMPIONS! 👑',
  '',
  '> "We asked 100 people... survey SAID!"',
  '',
  '1. Good night everybody!',
].join('\n');

const cleaned = spokenText(REAL_BAD_OUTRO);
check(cleaned.length > 0, 'a markdown-heavy reply still yields a usable line');
check(cleaned.length <= 320, 'the spoken line is capped for the caption bar and TTS');
check(!/[#*_`|]/.test(cleaned), 'markdown syntax is stripped (no # * _ ` |)');
check(cleaned.indexOf('\n') < 0, 'the spoken line is a single line');
check(!/^\s*[-*+]\s/m.test(cleaned) && !/^\s*\d+[.)]\s/m.test(cleaned), 'bullet and numbered list markers are gone');
check(cleaned.indexOf('---') < 0, 'horizontal rules are gone');
check(cleaned.indexOf('THAT\'S A WRAP') >= 0, 'the actual words survive the sanitizing');

// Well-behaved replies must pass through essentially untouched.
const good = 'Team B steals it at the buzzer — what a finish!';
check(spokenText(good) === good, 'a clean one-liner is left alone');
check(spokenText('') === '', 'empty input stays empty');
check(spokenText(null) === '', 'null input is safe');

// Sentence-boundary truncation, not a mid-word chop.
const long = ('Sentence one is here. ').repeat(40);
const cut = spokenText(long);
check(cut.length <= 320 && /\.$/.test(cut), 'over-long text is cut on a sentence boundary');

// The prompt-side half of the belt-and-braces fix.
check(/no markdown/i.test(SPOKEN_CONSTRAINT) && /emoji/i.test(SPOKEN_CONSTRAINT), 'the spoken constraint forbids markdown and emoji');
check(/one or two/i.test(SPOKEN_CONSTRAINT), 'the spoken constraint demands brevity');

// ── Host data replies: tolerant JSON extraction ─────────────────────────────
check(extractJson('```json\n{"a":1}\n```').a === 1, 'fenced json is extracted');
check(extractJson('sure! {"a":2} there you go').a === 2, 'bare json is extracted from prose');
check(extractJson('{"nested":{"deep":[1,2]},"x":3}').x === 3, 'balanced braces survive nesting');
check(extractJson('no json at all') === null, 'a reply with no json returns null');
check(extractJson('{"broken":') === null, 'malformed json returns null rather than throwing');
check(extractJson('{"s":"a } brace in a string","k":9}').k === 9, 'braces inside strings do not end the scan');

// ── Backlog #4: the show open is auto-narrated exactly once ─────────────────
// A tiny in-memory room world around the REAL host service + REAL whammy show
// module. mutate applies reducers against held state; the orchestrator spy
// resolves a deferred the moment the intro prompt arrives, so the async
// fire-and-forget dispatch is awaited deterministically — no sleeps.

const WHAMMY_PANELS = {
  panels: Array.from({ length: 10 }, (_, i) => ({ label: 'Prize ' + i, value: 300 + i * 100, kind: 'cash' })),
};

/** @description A fresh Whammy room state at the given round (phase lobby = startable). */
function whammyLobbyState(round) {
  return {
    showId: 'whammy', phase: 'lobby', round,
    board: { panels: [], control: null, spinsLeft: {}, whammies: {}, lastStop: null, winner: null, spinsPerPlayer: 5 },
    scores: {}, host: { line: '', mode: '', at: 1 }, shot: { type: 'lobby', focus: null, serial: 0, at: 1 },
  };
}

/** @description In-memory room + pool doubles around one held state. */
function makeRoomWorld(initialState) {
  let state = initialState;
  const world = { hostEvents: [], onHostEvent: null };
  world.room = {
    access: async () => ({ room_id: 'r1', user_sub: 'host', show_id: 'whammy' }),
    mutate: async (_roomId, _sub, apply) => {
      const result = await apply({ state, room: { room_id: 'r1', user_sub: 'host', show_id: 'whammy' }, seats: [], isOwner: true, db: null });
      if (!result || result.ok === false) return { ok: false, status: (result && result.status) || 400, error: (result && result.error) || 'Rejected.' };
      state = result.state || state;
      (result.events || []).forEach((event) => {
        world.hostEvents.push(event);
        if (event.kind === 'host' && world.onHostEvent) world.onHostEvent(event);
      });
      return { ok: true, rev: 2, state };
    },
    setStatus: async () => ({ ok: true }),
    seatsOf: async () => [],
    resolveActor: () => ({ actor: {} }),
  };
  world.pool = {
    query: async (sql) => {
      if (/FROM gameshow_state/.test(sql)) return { rowCount: 1, rows: [{ state, rev: 1 }] };
      return { rowCount: 0, rows: [] };
    },
  };
  Object.defineProperty(world, 'state', { get: () => state });
  return world;
}

/** @description Orchestrator spy: records prompts, resolves introSeen on the intro dispatch. */
function makeOrchestratorSpy() {
  const spy = { prompts: [] };
  spy.introSeen = new Promise((resolve) => { spy._introResolve = resolve; });
  spy.orchestrator = {
    processMessage: async (_id, prompt) => {
      spy.prompts.push(prompt);
      if (/MODE: intro/.test(prompt)) spy._introResolve();
      return { response: 'Welcome to the big board — somebody press that button!' };
    },
  };
  return spy;
}

async function autoIntroGuards() {
  // The game's FIRST round (round 0 → 1) narrates the open, exactly once.
  const world = makeRoomWorld(whammyLobbyState(0));
  const spy = makeOrchestratorSpy();
  const host = createHostService({ pool: world.pool, orchestrator: spy.orchestrator, room: world.room, logger: null });
  const captionApplied = new Promise((resolve) => { world.onHostEvent = resolve; });
  const started = await host.run('host', 'r1', 'manual', { content: WHAMMY_PANELS });
  check(started.ok === true, 'the first round starts from manual content');
  check(world.state.round === 1 && world.state.phase === 'lights', 'the board opened (round 0 → 1)');
  await spy.introSeen;         // the fire-and-forget dispatch reaches the host bot
  await captionApplied;        // and its line lands as a room caption event
  check(world.state.host && world.state.host.mode === 'intro' && world.state.host.line.length > 0,
    'the intro line is applied as the room caption (the speaker surface voices it with the titles)');
  check(spy.prompts.filter((p) => /MODE: intro/.test(p)).length === 1, 'the open is narrated exactly once');

  // A LATER round start (round already > 0) never re-narrates the open.
  const world2 = makeRoomWorld(whammyLobbyState(1));
  const spy2 = makeOrchestratorSpy();
  const host2 = createHostService({ pool: world2.pool, orchestrator: spy2.orchestrator, room: world2.room, logger: null });
  const again = await host2.run('host', 'r1', 'manual', { content: WHAMMY_PANELS });
  check(again.ok === true, 'a later round starts from manual content');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  check(!spy2.prompts.some((p) => /MODE: intro/.test(p)), 'a later round start never re-narrates the open');
}

autoIntroGuards().then(() => {
  if (failures) { console.error(`\n✗ ${failures}/${checks} host guard checks failed`); process.exit(1); }
  console.log(`✓ Host output guards hold — ${checks} checks green (spoken-line sanitizing, tolerant json, auto-narrated open)`);
}).catch((error) => {
  console.error('✗ host guard suite crashed:', error);
  process.exit(1);
});
