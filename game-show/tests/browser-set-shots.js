/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-26 20:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Set-shot rig for the broadcast rebuild: stages every show's set to a photogenic beat with deterministic manual content (zero LLM), then photographs tv + stage surfaces for visual review. `npm run test:shots`. Same env contract as the browser playthrough (GS_BASE_URL, GS_PAT, PLAYWRIGHT_MODULE).
 * 2026-07-31 22:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #9 — the rig no longer races the NPC: the 🤖 sharp podium used to be seated BEFORE the scripted beat, and the open pages' sync polls let it take the beat first (claim the Whammy board, ring in on the Jeopardy clue, win the Feud buzz) so the rig's own action was refused. Now every scripted action runs with NO NPC seated, the clock is paused before any page opens (a paused timer freezes NPC actuation AND timeouts — lib/npc.js dueMove + clock.expired), and the NPC is seated only after the live beat is staged, frozen, so the bot character still renders in the beat shots. Staging is deterministic; every check must pass.
 */

'use strict';

/*
 * WHY THIS EXISTS: the playthrough proves behavior; this rig proves LOOKS. For
 * each of the four shows it creates a real room, seats two human podiums, pushes
 * hand-built content through POST /host mode:'manual' (skipping the LLM — the
 * same rail as game night with your own questions), advances to that show's most
 * photogenic beat via the public action API, and screenshots BOTH ?view=tv and
 * ?view=stage into _playthrough-shots/sets/ for a human to eyeball. Nothing here
 * asserts pixels; the checks assert the STAGING (room created, content landed,
 * beat reached, shot file written) so a red run means the rig — not taste — broke.
 *
 * DETERMINISM (#9): scripted actions run with NO NPC seated, and the round clock
 * is PAUSED before any page opens — the open pages' sync polls are what actuate
 * NPC moves and clock timeouts, so a frozen clock means nothing races the rig or
 * lapses mid-shoot. The 🤖 sharp NPC is seated only AFTER the live beat is
 * staged (behind the pause), so the bot character still renders in the beat
 * shots without ever being able to take the beat first.
 */

const fs = require('fs');
const path = require('path');

function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    path.resolve(__dirname, '../../../oshal/node_modules/playwright'),
    'c:/Projects/oshal/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_e) { /* next */ }
  }
  return null;
}

const BASE = process.env.GS_BASE_URL || 'http://localhost:35457';
const PAT = process.env.GS_PAT || '';
const HEADLESS = process.env.GS_HEADED !== '1';
const SHOTS_DIR = process.env.GS_SHOTS_DIR || path.join(__dirname, '..', '_playthrough-shots', 'sets');
// Surfaces re-render on their own sync poll (~1.4s cadence) — give every staged
// state change two cycles to land on screen before the camera clicks.
const SETTLE_MS = 3000;

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

// ── Deterministic manual content (the parsed shapes ingestGenerated expects) ──
// NOTE: the host desk's survey TEXT format is parsed client-side; from the API
// the payload must already be the parsed JSON shape per show.
const FEUD_CONTENT = {
  question: 'Name something you find in a kitchen?',
  answers: [
    { text: 'Refrigerator', points: 40, aliases: ['fridge'] },
    { text: 'Stove', points: 30, aliases: ['oven'] },
    { text: 'Sink', points: 20, aliases: [] },
    { text: 'Toaster', points: 10, aliases: [] },
  ],
};

const JEOPARDY_TITLES = ['World Capitals', 'Famous Firsts', 'Kitchen Science', 'The Space Race', 'Wordplay', 'Big Rivers'];
const JEOPARDY_CONTENT = {
  categories: JEOPARDY_TITLES.map((title, c) => ({
    title,
    clues: [0, 1, 2, 3, 4].map((r) => ({
      clue: `Set-dressing clue ${r + 1} for ${title} — this text sizes the takeover card`,
      answer: `Answer ${c + 1}-${r + 1}`,
    })),
  })),
};

const WHEEL_CONTENT = { category: 'Phrase', puzzle: 'A BLESSING IN DISGUISE' };

const WHAMMY_CONTENT = {
  panels: [
    { label: 'Trip to Maui', value: 1500, kind: 'cash' },
    { label: 'Big Bucks', value: 1000, kind: 'cash' },
    { label: 'New Bike', value: 400, kind: 'cash' },
    { label: 'Cash + Spin', value: 700, kind: 'cash-spin' },
    { label: 'Home Theater', value: 1250, kind: 'cash' },
    { label: 'Snack Attack', value: 150, kind: 'cash' },
    { label: 'Mystery Money', value: 850, kind: 'cash' },
    { label: 'Spa Day', value: 500, kind: 'cash' },
    { label: 'Double Dip', value: 600, kind: 'cash-spin' },
    { label: 'Jackpot Row', value: 2000, kind: 'cash' },
  ],
};

async function apiPost(ctx, pathname, body) {
  const res = await ctx.post(BASE + '/api/game-show' + pathname, { data: body || {} });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

async function apiState(ctx, roomId) {
  const res = await ctx.get(BASE + `/api/game-show/state?roomId=${roomId}`);
  return res.json().catch(() => ({}));
}

/** @description Create a room, seat TWO human podiums (no NPC yet — #9), push manual content. */
async function stageRoom(request, showId, content) {
  const room = await apiPost(request, '/rooms', { showId, hostName: 'MC Shots' });
  check(room.body.ok === true, `${showId}: room created`);
  const roomId = room.body.room && room.body.room.roomId;
  const pod1 = await apiPost(request, '/podium', { roomId, team: 'A', name: 'Ana' });
  const pod2 = await apiPost(request, '/podium', { roomId, team: 'B', name: 'Bo' });
  check(!!pod1.body.seatId && !!pod2.body.seatId, `${showId}: two human podiums seated (NPC comes later, frozen — #9)`);
  const started = await apiPost(request, '/host', { roomId, mode: 'manual', payload: { content } });
  check(started.body.ok === true, `${showId}: manual content landed (${started.status} ${started.body.error || 'ok'})`);
  return { roomId, pod1: pod1.body.seatId, pod2: pod2.body.seatId };
}

/**
 * @description Freeze the room's clock (host override) so the pages about to open
 *   cannot actuate an NPC move or a timeout mid-shoot. `hard` beats always carry a
 *   timer (answer/ring/consonant/turn windows) so a refusal there is a rig bug;
 *   board beats may legitimately have no clock yet (Jeopardy board, unclaimed
 *   Wheel) — with no timer there is nothing to lapse, so NO_TIMER is fine there.
 */
async function pauseClock(request, showId, roomId, hard) {
  const res = await apiPost(request, '/action', { roomId, action: { type: 'pauseTimer' } });
  const noTimer = res.body.ok !== true && /clock|timer/i.test(String(res.body.error || ''));
  if (hard) check(res.body.ok === true, `${showId}: clock paused before the camera opens (${res.status} ${res.body.error || 'ok'})`);
  else if (!res.body.ok && !noTimer) check(false, `${showId}: pause failed unexpectedly (${res.status} ${res.body.error || ''})`);
  else console.log(`  · ${showId}: board-beat clock ${res.body.ok ? 'paused' : 'not running (nothing to lapse)'}`);
}

/** @description Resume the clock so scripted actions play out on a live board. */
async function resumeClock(request, roomId) {
  await apiPost(request, '/action', { roomId, action: { type: 'resumeTimer' } }).catch(() => {});
}

/** @description Seat the 🤖 sharp NPC AFTER the beat is staged and the clock is paused — it renders, it never races (#9). */
async function seatFrozenNpc(request, showId, roomId) {
  const npc = await apiPost(request, '/podium', { roomId, team: 'B', npc: 'sharp' });
  check(!!npc.body.seatId, `${showId}: 🤖 sharp NPC seated frozen behind the paused clock`);
}

/** @description Screenshot tv + stage (stage pinned to podium 1 so the player dock shows) for one beat. */
async function shoot(context, room, showId, beat) {
  for (const view of ['tv', 'stage']) {
    const page = await context.newPage();
    const asParam = view === 'stage' ? '&as=' + room.pod1 : '';
    await page.goto(`${BASE}/api/game-show/stage?view=${view}&room=${room.roomId}${asParam}`);
    await page.waitForTimeout(SETTLE_MS);
    const file = path.join(SHOTS_DIR, `${showId}-${beat}-${view}.png`);
    await page.screenshot({ path: file });
    check(fs.existsSync(file), `${showId}: shot ${beat}/${view} → ${path.basename(file)}`);
    await page.close();
  }
}

// ── Per-show staging to the photogenic beat ──────────────────────────────────

async function stageFeud(request, room) {
  const buzz = await apiPost(request, '/action', { roomId: room.roomId, action: { type: 'buzz' }, actorSeatId: room.pod1 });
  check(buzz.body.ok === true, 'family-feud: podium 1 wins the buzz');
  const ans = await apiPost(request, '/answer', { roomId: room.roomId, guess: 'Refrigerator', actorSeatId: room.pod1 });
  check(ans.body.ok === true, 'family-feud: top answer rules locally');
  const st = await apiState(request, room.roomId);
  check(st.state && st.state.phase === 'play', `family-feud: reached play (phase=${st.state && st.state.phase})`);
  return 'play';
}

async function stageJeopardy(request, room) {
  const pick = await apiPost(request, '/action', { roomId: room.roomId, action: { type: 'pick', cat: 0, row: 0 }, actorSeatId: room.pod1 });
  check(pick.body.ok === true, 'jeopardy: podium 1 picks cat 0 row 0');
  let st = await apiState(request, room.roomId);
  if (st.state && st.state.phase === 'daily-wager') {
    const wager = await apiPost(request, '/action', { roomId: room.roomId, action: { type: 'wager', amount: 500 }, actorSeatId: room.pod1 });
    check(wager.body.ok === true, 'jeopardy: daily double — wagered 500');
    st = await apiState(request, room.roomId);
  }
  check(st.state && st.state.phase === 'clue', `jeopardy: clue takeover reached (phase=${st.state && st.state.phase})`);
  return 'clue';
}

async function stageWheel(request, room) {
  // Bankrupt / lose-a-turn resolves instantly and passes the wheel — retry from
  // whichever seat now holds control until a $ value is pending on the wheel.
  let pending = false;
  for (let attempt = 1; attempt <= 5 && !pending; attempt++) {
    const st = await apiState(request, room.roomId);
    const actor = (st.state && st.state.board && st.state.board.control) || room.pod1;
    const spin = await apiPost(request, '/action', { roomId: room.roomId, action: { type: 'spin' }, actorSeatId: actor });
    if (spin.body.ok !== true) { console.log(`  · wheel spin attempt ${attempt} rejected: ${spin.body.error || spin.status}`); continue; }
    const after = await apiState(request, room.roomId);
    const spinState = after.state && after.state.board && after.state.board.spin;
    if (spinState && spinState.value != null) pending = true;
    else console.log(`  · wheel spin attempt ${attempt} hit bankrupt/lose-turn — respinning`);
  }
  check(pending, 'wheel: a $ spin is pending on the wheel');
  return 'spin';
}

async function stageWhammy(request, room) {
  const press = await apiPost(request, '/action', { roomId: room.roomId, action: { type: 'pressYourLuck' }, actorSeatId: room.pod1 });
  check(press.body.ok === true, 'whammy: podium 1 pressed their luck');
  const st = await apiState(request, room.roomId);
  check(!!(st.state && st.state.board && st.state.board.lastStop), 'whammy: the board recorded the stop');
  return 'press';
}

const SHOWS = [
  { showId: 'family-feud', content: FEUD_CONTENT, stage: stageFeud, boardBeat: 'faceoff' },
  { showId: 'jeopardy', content: JEOPARDY_CONTENT, stage: stageJeopardy, boardBeat: 'board' },
  { showId: 'wheel', content: WHEEL_CONTENT, stage: stageWheel, boardBeat: 'puzzle' },
  { showId: 'whammy', content: WHAMMY_CONTENT, stage: stageWhammy, boardBeat: 'lights' },
];

async function main() {
  const playwright = resolvePlaywright();
  if (!playwright) {
    console.error('✗ BLOCKED: playwright is not resolvable. Set PLAYWRIGHT_MODULE to a playwright install (the core oshal checkout has one).');
    process.exit(2);
  }
  const headers = PAT ? { authorization: 'Bearer ' + PAT } : {};
  const request = await playwright.request.newContext({ extraHTTPHeaders: headers });

  // Preflight: the stack must be reachable and must recognize us.
  const shows = await request.get(BASE + '/api/game-show/shows').then(async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) })).catch(() => null);
  if (!shows || shows.status !== 200) {
    console.error(`✗ BLOCKED: ${BASE}/api/game-show/shows -> ${shows ? shows.status : 'unreachable'}. Start the stack (scripts/oshal-up.sh) and pass GS_PAT (live auth) or run a MOCK_OIDC server.`);
    process.exit(2);
  }
  check(Array.isArray(shows.body.shows) && shows.body.shows.length >= 4, 'the show catalog lists all four shows');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ extraHTTPHeaders: headers, viewport: { width: 1280, height: 800 } });
  const openRooms = [];
  try {
    // The lobby glamour shot — no room, forced lobby chrome.
    const lobby = await context.newPage();
    await lobby.goto(`${BASE}/api/game-show/stage?lobby=1`);
    await lobby.waitForTimeout(SETTLE_MS);
    const lobbyFile = path.join(SHOTS_DIR, 'lobby.png');
    await lobby.screenshot({ path: lobbyFile });
    check(fs.existsSync(lobbyFile), 'lobby shot → lobby.png');
    await lobby.close();

    for (const spec of SHOWS) {
      console.log(`\n── ${spec.showId} ──`);
      const room = await stageRoom(request, spec.showId, spec.content);
      if (!room.roomId) continue;
      openRooms.push(room.roomId);
      await pauseClock(request, spec.showId, room.roomId, false);     // soft: board beats may have no clock yet
      await shoot(context, room, spec.showId, spec.boardBeat);        // the fresh set, content up — nothing seated can race
      await resumeClock(request, room.roomId);
      const beat = await spec.stage(request, room);                   // advance to the live beat (still NPC-free)
      await pauseClock(request, spec.showId, room.roomId, true);      // hard: every live beat carries a timer
      await seatFrozenNpc(request, spec.showId, room.roomId);         // the bot character renders, frozen
      await shoot(context, room, spec.showId, beat);
    }
  } finally {
    for (const roomId of openRooms) {
      await apiPost(request, '/status', { roomId, status: 'ended' }).catch(() => {});
    }
    await browser.close();
  }

  if (failures) { console.error(`\n✗ ${failures}/${checks} set-shot checks failed`); process.exit(1); }
  console.log(`\n✓ Set shots staged — ${checks} checks green. Review the frames in: ${SHOTS_DIR}`);
}

main().catch((error) => { console.error('✗ set-shot rig crashed:', error); process.exit(1); });
