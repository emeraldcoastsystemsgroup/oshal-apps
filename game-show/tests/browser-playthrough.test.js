/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 14:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | THE browser playthrough (backlog P0 #1): a full Family Feud round played in real browser pages — big screen, host desk, and two phone clickers — against a running stack, deterministically (manual survey + exact-alias localJudge; zero LLM calls). `npm run test:browser`. Needs a reachable api (GS_BASE_URL, default the local stack) and either MOCK_OIDC on the server or GS_PAT for the live stack; Playwright resolves from the core repo checkout or PLAYWRIGHT_MODULE.
 */

'use strict';

/*
 * WHY THIS EXISTS: every engine rule is unit-tested, but "the five surfaces
 * render one synced state on real devices" was only ever proven by hand. This
 * drives the REAL pages a game night uses:
 *   tv         — asserts the join code, BUZZ IN!, reveals, and the celebration
 *   host desk  — plays the host's OWN survey (mode 'manual'), watches the key
 *   clicker ×2 — pinned to two hotseat podiums via ?as=, buzz + type answers
 *   audience   — sends a reaction every surface floats
 * Determinism: the survey is typed by the test (a real feature — game night with
 * your own questions), and every guess is an exact answer text, so localJudge
 * rules without an LLM. Misses are exercised via the host's "move it along".
 */

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
const SHOTS_DIR = process.env.GS_SHOTS_DIR || path.join(__dirname, '..', '_playthrough-shots');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

const SURVEY_TEXT = [
  'Name something you find in a kitchen?',
  'Refrigerator | 40 | fridge',
  'Stove | 30 | oven',
  'Sink | 20',
  'Toaster | 10',
].join('\n');
const ANSWERS = ['Refrigerator', 'Stove', 'Sink', 'Toaster'];

/**
 * Wait until a page's body text matches, polling — surfaces re-render on their own
 * sync. Case-insensitive: innerText is RENDERED text, and board slots uppercase
 * their answers via CSS text-transform.
 */
async function waitForText(page, text, ms = 15000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.toLowerCase().indexOf(t.toLowerCase()) >= 0, text, { timeout: ms });
    return true;
  } catch (_e) { return false; }
}

async function apiPost(ctx, pathname, body) {
  const res = await ctx.post(BASE + '/api/game-show' + pathname, { data: body || {} });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

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

  // Stage the room server-side (the lobby UI is exercised by loading it below).
  const room = await apiPost(request, '/rooms', { showId: 'family-feud', hostName: 'MC Test' });
  check(room.body.ok === true, 'a Feud room is created');
  const roomId = room.body.room.roomId;
  const podA = await apiPost(request, '/podium', { roomId, team: 'A', name: 'Ana' });
  const podB = await apiPost(request, '/podium', { roomId, team: 'B', name: 'Bo' });
  check(!!podA.body.seatId && !!podB.body.seatId, 'two hotseat podiums are seated');

  const browser = await playwright.chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ extraHTTPHeaders: headers, viewport: { width: 1280, height: 800 } });
  const url = (view, extra) => `${BASE}/api/game-show/stage?view=${view}&room=${roomId}${extra || ''}`;

  const tv = await context.newPage(); await tv.goto(url('tv'));
  const host = await context.newPage(); await host.goto(url('host'));
  // The clickers are PHONES — phone-sized, so the fold assertions below mean something.
  const phone = { width: 390, height: 844 };
  const clickerA = await context.newPage(); await clickerA.setViewportSize(phone); await clickerA.goto(url('clicker', '&as=' + podA.body.seatId));
  const clickerB = await context.newPage(); await clickerB.setViewportSize(phone); await clickerB.goto(url('clicker', '&as=' + podB.body.seatId));
  const audience = await context.newPage(); await audience.goto(url('audience'));

  try {
    // ── The page is a page, not a source dump ─────────────────────────────────
    // Guard for the inlineUiScripts $-substitution bug: a broken inline splice
    // renders script SOURCE as body text.
    await waitForText(tv, 'GAME SHOW');
    const leaked = await tv.evaluate(() => document.body.innerText.indexOf('registerShowUi') >= 0);
    check(!leaked, 'no script source leaks into the rendered page');

    // ── Lobby: the big screen is the invitation (code + QR) ───────────────────
    check(await waitForText(tv, room.body.room.joinCode), 'TV shows THIS room\'s code');
    await tv.waitForTimeout(1200);
    const qrOk = await tv.evaluate(() => {
      const img = document.querySelector('img.gs-qr');
      return !!img && img.naturalWidth > 0;
    });
    check(qrOk, 'TV shows a scannable QR for the join link');
    // Host desk: open the Show-tools drawer once — it stays open for the phase pills.
    await host.getByText('🔧 Show tools').click();
    check(await waitForText(host, 'Phase: lobby'), 'host desk shows the lobby phase');
    check(await waitForText(clickerA, 'Ana'), 'clicker A is pinned to Ana\'s podium');

    // ── The player screen is a SHOW, not an admin page ────────────────────────
    const stagePlayer = await context.newPage(); await stagePlayer.goto(url('stage'));
    await waitForText(stagePlayer, 'Start the show');
    const adminText = await stagePlayer.evaluate(() => {
      const t = document.body.innerText;
      return ['Show me as:', 'Hotseat', 'Phase:'].filter((s) => t.indexOf(s) >= 0);
    });
    check(adminText.length === 0, 'no admin labels on the player view (found: ' + adminText.join(',') + ')');
    check(await waitForText(stagePlayer, '▶ Start the show'), 'the owner sees one big Start-the-show button');

    // ── The host plays their OWN survey (no LLM) ─────────────────────────────
    await host.getByText('✍ Use my own questions').click();
    await host.locator('textarea').fill(SURVEY_TEXT);
    await host.getByText('Play my questions').click();
    check(await waitForText(host, 'Phase: faceoff'), 'the manual survey opens the face-off');
    check(await waitForText(tv, 'BUZZ IN!'), 'TV calls the buzzer race');
    check(await waitForText(host, 'Refrigerator'), 'the host answer key shows the hidden board');

    // ── THE FOLD FIX: on a phone mid-buzz-window, the buzzer is on screen ─────
    // (The audit measured the old buzzer at top=933px in an 844px viewport.)
    await clickerA.waitForTimeout(1500);
    const buzzBox = await clickerA.locator('.gs-buzz-btn').boundingBox();
    check(!!buzzBox && buzzBox.y >= 0 && buzzBox.y + buzzBox.height <= 844,
      `the phone buzzer sits fully inside the viewport (y=${buzzBox && Math.round(buzzBox.y)})`);
    // And the SHOW view's dock buzz bar is pinned on-screen at phone size too.
    const phoneShow = await context.newPage(); await phoneShow.setViewportSize(phone);
    await phoneShow.goto(url('stage', '&as=' + podB.body.seatId));
    await phoneShow.waitForTimeout(1800);
    const dockBox = await phoneShow.locator('.gs-dockbuzz').boundingBox();
    check(!!dockBox && dockBox.y + dockBox.height <= 844,
      `the show view's dock buzzer is pinned inside the viewport (y=${dockBox && Math.round(dockBox.y)})`);
    await phoneShow.close();

    // ── The buzz race: phone A wins the lock ─────────────────────────────────
    await clickerA.locator('.gs-buzz-btn').click();
    check(await waitForText(clickerA, '✋', 5000), 'clicker A locks the buzz');
    const bLocked = await clickerB.locator('.gs-buzz-btn.locked').count();
    check(bLocked === 0, 'clicker B did NOT get the lock');
    check(await waitForText(clickerB, 'buzzed first'), 'the losing phone is TOLD who buzzed first');

    // ── Face-off answer: exact text rules locally, no LLM ────────────────────
    await clickerA.locator('#gs-dock input.gs-input').first().fill(ANSWERS[0]);
    await clickerA.keyboard.press('Enter');
    check(await waitForText(tv, 'Refrigerator'), 'the top answer flips up on the big screen');
    check(await waitForText(host, 'Phase: play'), 'the top answer takes control straight to play');

    // ── A miss without an LLM: the host "moves it along" (timeout = judged miss)
    await host.getByText('⏭ Move it along').click();
    await tv.waitForTimeout(1500);
    const strikes = await tv.locator('.gs-x').count();
    check(strikes >= 1, 'a lapsed answer is a strike — the ✗ lands on the big screen');

    // ── Team A clears the board ──────────────────────────────────────────────
    for (let i = 1; i < ANSWERS.length; i++) {
      await clickerA.locator('#gs-dock input.gs-input').first().fill(ANSWERS[i]);
      await clickerA.keyboard.press('Enter');
      await tv.waitForTimeout(300);
    }
    check(await waitForText(tv, 'TEAM A WINS!'), 'clearing the board crowns Team A on the big screen');
    check(await waitForText(host, 'Phase: round-win'), 'the host desk lands on round-win');
    const confetti = await tv.locator('.gs-confetti').count();
    check(confetti > 0, 'the celebration shot throws confetti');

    // ── Reactions broadcast (backlog #16) ────────────────────────────────────
    await audience.locator('.gs-reacts button').first().click();
    // The float is transient; the durable proof is the react event in the log
    // that every other surface's sync tail delivers.
    await tv.waitForTimeout(2000);
    const events = await request.get(BASE + `/api/game-show/state?roomId=${roomId}`).then((r) => r.json());
    check((events.events || []).some((e) => e.kind === 'react'), 'the reaction lands in the room event log (every surface floats it)');

    // ── Cost visibility (#15): inside Show tools (zero spend — no LLM used) ──
    check(await waitForText(host, 'AI spend $0.00'), 'Show tools reports this game cost $0.00 (fully local playthrough)');

    // ── Easy login: the QR/link deep-link auto-joins, zero taps to seated ────
    const guestHeaders = process.env.GS_PAT2 ? { authorization: 'Bearer ' + process.env.GS_PAT2 } : headers;
    const guestCtx = await browser.newContext({ extraHTTPHeaders: guestHeaders, viewport: phone });
    const guest = await guestCtx.newPage();
    await guest.goto(`${BASE}/api/game-show/stage?join=${room.body.room.joinCode}`);
    const seated = await waitForText(guest, 'BUZZ', 12000) || await waitForText(guest, 'You\'re in', 4000) || await waitForText(guest, 'Team', 4000);
    check(seated, 'scanning the QR (deep link) seats the guest with ZERO taps');
    await guestCtx.close();

    // ── Rehearsal shell: every surface in one window ─────────────────────────
    const rehearsal = await context.newPage(); await rehearsal.goto(url('rehearsal'));
    check(await waitForText(rehearsal, 'Rehearsal — the whole studio in one window'), 'the rehearsal view mounts');
    await rehearsal.waitForTimeout(2500);
    const frames = await rehearsal.locator('iframe').count();
    check(frames >= 4, `rehearsal embeds every surface (${frames} frames: tv, host, two clickers, audience)`);
    try { require('fs').mkdirSync(SHOTS_DIR, { recursive: true }); await rehearsal.screenshot({ path: path.join(SHOTS_DIR, 'rehearsal.png'), fullPage: true }); await tv.screenshot({ path: path.join(SHOTS_DIR, 'tv-celebration.png') }); } catch (_e) { /* shots are best-effort */ }

    // ── End the game: presence prunes, scores snapshot (#13/#19) ─────────────
    const ended = await apiPost(request, '/status', { roomId, status: 'ended' });
    check(ended.body.ok === true, 'the host ends the game');
  } finally {
    await browser.close();
  }

  if (failures) { console.error(`\n✗ ${failures}/${checks} browser-playthrough checks failed`); process.exit(1); }
  console.log(`\n✓ Browser playthrough holds — ${checks} checks green (a full Feud round on real surfaces, zero LLM). Screenshots: ${SHOTS_DIR}`);
}

main().catch((error) => { console.error('✗ playthrough crashed:', error); process.exit(1); });
