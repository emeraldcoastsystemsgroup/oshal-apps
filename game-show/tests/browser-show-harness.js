/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the shared authenticated Playwright/live-server harness for per-show browser scenarios, including bounded state polling and guaranteed room cleanup.
 */

'use strict';

const path = require('path');

const DEFAULT_BASE = 'http://localhost:35457';
const DEFAULT_WAIT_MS = 10000;
const POLL_MS = 100;

/** @description Pause bounded polling without importing a test framework. */
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** @description Resolve Playwright from an explicit override, this package, or the adjacent core checkout. */
function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    path.resolve(__dirname, '../../../oshal/node_modules/playwright'),
    'c:/Projects/oshal/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_error) { /* try the next sanctioned location */ }
  }
  return null;
}

/** @description Create an error whose exit code distinguishes unavailable infrastructure from a failed scenario. */
function blocked(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

/**
 * @description Owns one browser scenario's real HTTP request context, Chromium context,
 *   assertions, and disposable Game Show rooms.
 */
class BrowserShowHarness {
  /** @description Capture environment configuration without opening external resources. */
  constructor(label) {
    this.label = label;
    this.base = process.env.GS_BASE_URL || DEFAULT_BASE;
    this.headers = process.env.GS_PAT ? { authorization: 'Bearer ' + process.env.GS_PAT } : {};
    this.headless = process.env.GS_HEADED !== '1';
    this.failures = 0;
    this.checks = 0;
    this.roomIds = [];
  }

  /** @description Record one readable assertion while allowing independent checks to finish. */
  check(condition, message) {
    this.checks++;
    console.log((condition ? '  ✓ ' : '  ✗ ') + message);
    if (!condition) this.failures++;
    return !!condition;
  }

  /** @description Record a critical assertion and stop the scenario before later steps report noise. */
  require(condition, message) {
    if (!this.check(condition, message)) throw new Error(this.label + ': ' + message);
  }

  /** @description Open the authenticated request/browser contexts and prove the live package route is reachable. */
  async start() {
    this.playwright = resolvePlaywright();
    if (!this.playwright) {
      throw blocked('Playwright is not resolvable. Set PLAYWRIGHT_MODULE to the core oshal Playwright install.');
    }
    this.request = await this.playwright.request.newContext({ extraHTTPHeaders: this.headers });
    const catalog = await this.get('/shows').catch(() => null);
    if (!catalog || catalog.status !== 200) {
      throw blocked(`${this.base}/api/game-show/shows -> ${catalog ? catalog.status : 'unreachable'}. Start a MOCK_OIDC local server or pass GS_PAT for the live stack.`);
    }
    this.require(Array.isArray(catalog.body.shows) && catalog.body.shows.length >= 4,
      'the live show catalog exposes all four registered shows');
    this.browser = await this.playwright.chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({ extraHTTPHeaders: this.headers, viewport: { width: 1280, height: 800 } });
  }

  /** @description GET one Game Show API resource and parse its JSON body. */
  async get(pathname) {
    const response = await this.request.get(this.base + '/api/game-show' + pathname);
    return { status: response.status(), body: await response.json().catch(() => ({})) };
  }

  /** @description POST one Game Show API command and parse its JSON body. */
  async post(pathname, body) {
    const response = await this.request.post(this.base + '/api/game-show' + pathname, { data: body || {} });
    return { status: response.status(), body: await response.json().catch(() => ({})) };
  }

  /** @description Read the authoritative live state envelope for a room. */
  async state(roomId) { return (await this.get('/state?roomId=' + encodeURIComponent(roomId))).body; }

  /** @description Poll authoritative room state until a predicate holds or the bounded deadline expires. */
  async waitForState(roomId, predicate, timeoutMs = DEFAULT_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    let latest = null;
    while (Date.now() < deadline) {
      latest = await this.state(roomId);
      if (predicate(latest)) return latest;
      await sleep(POLL_MS);
    }
    return latest;
  }

  /** @description Wait for rendered, case-insensitive body text on a real browser surface. */
  async waitForText(page, expected, timeoutMs = DEFAULT_WAIT_MS) {
    try {
      await page.waitForFunction((text) => document.body.innerText.toLowerCase().includes(text.toLowerCase()), expected, { timeout: timeoutMs });
      return true;
    } catch (_error) { return false; }
  }

  /** @description Create a disposable room and two owner-driven hotseat podiums. */
  async createRoom(showId, content, suffix = '') {
    const created = await this.post('/rooms', { showId, hostName: 'MC Browser ' + this.label });
    this.require(created.status === 200 && created.body.ok === true, `${showId}${suffix}: room created through the live route`);
    const roomId = created.body.room && created.body.room.roomId;
    this.roomIds.push(roomId);
    const seats = await this.addPlayers(roomId, showId, suffix);
    await this.startManual(roomId, showId, content, suffix);
    return { roomId, showId, room: created.body.room, seats };
  }

  /** @description Seat the two browser-driven players used by every signature scenario. */
  async addPlayers(roomId, showId, suffix) {
    const specs = [{ name: 'Ana', team: 'A' }, { name: 'Bo', team: 'B' }];
    const responses = [];
    for (const spec of specs) responses.push(await this.post('/podium', { roomId, name: spec.name, team: spec.team }));
    const seats = responses.map((response, index) => ({ seatId: response.body.seatId, name: specs[index].name }));
    this.require(seats.every((seat) => !!seat.seatId), `${showId}${suffix}: two hotseat podiums seated through the live route`);
    return seats;
  }

  /** @description Start generated-shape manual content through the same zero-LLM host rail exposed to operators. */
  async startManual(roomId, showId, content, suffix) {
    const started = await this.post('/host', { roomId, mode: 'manual', payload: { content } });
    this.require(started.status === 200 && started.body.ok === true,
      `${showId}${suffix}: deterministic manual content accepted by the live host route`);
  }

  /** @description Build one package surface URL, optionally pinned to an owner-controlled hotseat. */
  surfaceUrl(view, roomId, seatId) {
    const actor = seatId ? '&as=' + encodeURIComponent(seatId) : '';
    return `${this.base}/api/game-show/stage?view=${view}&room=${encodeURIComponent(roomId)}${actor}`;
  }

  /** @description Open one real package surface and wait until its show-specific client registered and rendered. */
  async openSurface(view, room, seatId) {
    const page = await this.context.newPage();
    await page.goto(this.surfaceUrl(view, room.roomId, seatId), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((showId) => document.body.dataset.gsShow === showId, room.showId, { timeout: DEFAULT_WAIT_MS });
    return page;
  }

  /** @description Open the broadcast TV plus one real stage surface per hotseat. */
  async openRoomSurfaces(room) {
    const tv = await this.openSurface('tv', room);
    const players = {};
    for (const seat of room.seats) players[seat.seatId] = await this.openSurface('stage', room, seat.seatId);
    return { tv, players, all: [tv].concat(Object.values(players)) };
  }

  /** @description Close a room's browser pages before a bounded retry creates another room. */
  async closeSurfaces(surfaces) {
    for (const page of (surfaces && surfaces.all) || []) await page.close().catch(() => {});
  }

  /** @description End every disposable room and release request/browser resources even after a failed assertion. */
  async cleanup() {
    if (this.request) {
      for (const roomId of this.roomIds) {
        await this.post('/status', { roomId, status: 'ended' }).catch(() => {});
      }
    }
    if (this.browser) await this.browser.close().catch(() => {});
    if (this.request) await this.request.dispose().catch(() => {});
  }

  /** @description Emit the final scenario result and set a failing process status when any assertion is red. */
  finish(summary) {
    if (this.failures) {
      console.error(`\n✗ ${this.failures}/${this.checks} ${this.label} browser checks failed`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n✓ ${this.label} browser scenario holds — ${this.checks} checks green (${summary})`);
  }
}

/**
 * @description Run one scenario with consistent preflight, cleanup, blocked-state reporting, and result output.
 * @param {string} label - Human-readable show name.
 * @param {string} summary - Success evidence printed after all checks pass.
 * @param {(harness:BrowserShowHarness)=>Promise<void>} scenario - The live browser scenario.
 * @returns {Promise<void>} Resolves after resources are released and exit status is set.
 */
async function runBrowserScenario(label, summary, scenario) {
  const harness = new BrowserShowHarness(label);
  let problem = null;
  try {
    await harness.start();
    await scenario(harness);
  } catch (error) { problem = error; }
  finally { await harness.cleanup(); }
  if (problem) {
    const prefix = problem.exitCode === 2 ? '✗ BLOCKED' : '✗ ' + label + ' scenario crashed';
    console.error(prefix + ': ' + problem.message);
    process.exitCode = problem.exitCode || 1;
    return;
  }
  harness.finish(summary);
}

module.exports = { BrowserShowHarness, runBrowserScenario };
