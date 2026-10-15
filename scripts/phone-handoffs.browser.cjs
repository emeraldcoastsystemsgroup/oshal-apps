/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone-width proof for the third sweep's layout and hand-off defects (2026-10-11), in headless Chromium against the real page files with synthetic read answers and no provider call. In the cockpit's application frame (392 x 641): the Aero Lab, Drone and Sat Ops hand-off panels sit in the page flow (elementFromPoint at every slider / the Fleet panel finds that control, not the panel). Sat Ops primary buttons stay light on their navy fill under a dark host --text-primary, and Remove (tap twice) sends DELETE /api/sat/catalog/:id and drops the row. Drone's Save as timeline is off with the geofence reason. Calendar's sync refusal is on screen beside its button. The D&D table title keeps its width and the "Previously on…" banner clears Timeline and Party. Feeds' Sync now names the missing Slack connection and the closed settings drawer is hidden with no shadow band.
 * -----------------------------------------------------------------------------
 *
 * Usage: node scripts/phone-handoffs.browser.cjs              (every screen)
 *        node scripts/phone-handoffs.browser.cjs sat-ops feeds (named screens)
 *        SHOTS=<dir> ...                                       (also save a screenshot per screen)
 *        STORE_ROOT=<dir> ...                                  (prove another tree, e.g. a HEAD archive: it must go red)
 * Needs the store toolchain (npm ci --prefix scripts/toolchain) for express and playwright, or STORE_CI_TOOLCHAIN.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const store = path.resolve(process.env.STORE_ROOT || path.join(__dirname, '..'));
const toolchain = process.env.STORE_CI_TOOLCHAIN || path.join(__dirname, 'toolchain', 'node_modules');
if (!fs.existsSync(path.join(toolchain, 'playwright'))) {
  console.error('phone-handoffs: no toolchain with playwright (npm ci --prefix scripts/toolchain, or set STORE_CI_TOOLCHAIN)');
  process.exit(2);
}
const express = require(path.join(toolchain, 'express'));
const { chromium } = require(path.join(toolchain, 'playwright'));

/** The cockpit's application frame on a 412px phone, and the phone itself. */
const FRAME = { width: 392, height: 641 };
const PHONE = { width: 412, height: 915 };
const MODULES = {
  '/cockpit/js/app-workflows.js': 'export async function mountConnectedActions(o){window.__mounted=o.app;}',
  '/cockpit/js/app-handoff.js': 'export function receiveHandoff(){}',
};

/** Whatever elementFromPoint finds at the centre of `selector` (scrolled into view) must be that element or inside it. */
async function reachable(page, selector, label) {
  const misses = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => {
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && (hit === e || e.contains(hit)) ? null : `${e.id || e.tagName} under ${hit ? (hit.closest('[id]') || hit).id || hit.tagName : 'nothing'}`;
  }).filter(Boolean), selector);
  assert.deepEqual(misses, [], `${label}: covered controls`);
}

async function docked(page, id, label) {
  const pos = await page.evaluate((i) => getComputedStyle(document.getElementById(i)).position, id);
  assert.notEqual(pos, 'fixed', `${label}: the hand-off panel floats over the page at phone width`);
}

const droneReads = { '/api/drone/fleet': { fleet: [], fence: null, configured: false, native: true, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered.' },
  '/api/drone/missions': { missions: [] }, '/api/drone/show/status': { active: false, phase: 'idle', drones: [] }, '/api/drone/conversation': { messages: [] } };

const satState = { catalog: [{ satId: 'sat-a', satnum: 25544, name: 'ISS' }, { satId: 'sat-b', satnum: 43013, name: 'NOAA' }] };

const SCREENS = [
  { name: 'aero-lab', url: '/api/aero-lab/app', file: 'aero-lab/tools/aero-lab.html', view: FRAME, modules: MODULES,
    files: { '/api/aero-lab/app.js': 'aero-lab/tools/aero-lab.js', '/api/aero-lab/geometry.js': 'aero-lab/tools/aero-lab-geometry.js' }, reads: {},
    check: async (page) => {
      await docked(page, 'labReview', 'aero-lab');
      await reachable(page, 'input[type=range]', 'aero-lab');
    } },
  { name: 'drone', url: '/api/drone/app', file: 'drone/tools/drone-ops.html', view: FRAME, reads: droneReads,
    check: async (page) => {
      await page.waitForFunction(() => !document.getElementById('noDroneBanner').hidden);
      await docked(page, 'evidenceReview', 'drone');
      await reachable(page, '#fleetList, #fleetList *:not(:has(*))', 'drone fleet panel');
      const t = await page.evaluate(() => { const b = document.querySelector('button[onclick="saveTimeline()"]'); return { disabled: b.disabled, title: b.title }; });
      assert.equal(t.disabled, true, 'Save as timeline is on with no geofence');
      assert.match(t.title, /Planning needs a geofence and a home position/);
    } },
  { name: 'sat-ops', url: '/api/sat/app', file: 'sat-ops/tools/sat-ops.html', view: FRAME,
    reads: { '/api/sat/fleet': { fleet: [] }, '/api/sat/catalog': () => ({ catalog: satState.catalog }) },
    posts: { '/api/sat/track': { status: 404, body: { error: 'no track in this fixture' } } },
    deletes: { '/api/sat/catalog/:id': (id) => { satState.catalog = satState.catalog.filter((c) => c.satId !== id); return { ok: true }; } },
    init: async (page) => page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--text-primary', 'rgb(37, 43, 60)'))),
    check: async (page) => {
      const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const colors = await page.evaluate(() => [...document.querySelectorAll('button.primary')].map((b) => ({ id: b.id, c: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })));
      for (const { id, c, bg } of colors) {
        const [a, b] = [lum(c), lum(bg)].sort((x, y) => y - x);
        assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `sat-ops #${id}: ${c} on ${bg} is unreadable`);
      }
      await page.waitForSelector('#catalogList .sat-row');
      const remove = page.locator('#catalogList .sat-row', { hasText: 'sat-a' }).locator('button.remove');
      await remove.click();
      assert.equal(await remove.textContent(), 'Confirm remove', 'the first tap only arms Remove');
      await remove.click();
      await page.waitForFunction(() => ![...document.querySelectorAll('#catalogList .sat-row')].some((r) => r.textContent.includes('sat-a')));
      assert.deepEqual(satState.catalog.map((c) => c.satId), ['sat-b']);
      await docked(page, 'evidenceReview', 'sat-ops');
    } },
  { name: 'calendar', url: '/api/calendar/review', file: 'calendar/tools/review.html', view: PHONE, modules: MODULES,
    reads: { '/api/calendar/home-summary': { metrics: [], items: [] }, '/api/calendar/meeting-briefs': { briefs: [] } },
    posts: { '/api/calendar/sync': { status: 409, body: { error: 'Connect Google in Identity with Calendar read access, then retry.' } } },
    check: async (page) => {
      await page.click('#syncCalendar');
      const el = page.getByText('Connect Google in Identity with Calendar read access, then retry.');
      await el.waitFor();
      const box = await el.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= PHONE.height, `the sync result is off-screen at y=${Math.round(box.y)}`);
      await reachable(page, '#syncStatus', 'calendar sync result');
    } },
  { name: 'dnd-table', url: '/dnd-fixture', view: FRAME, reads: {}, dir: { '/api/dnd/ui': 'dnd/ui' },
    html: '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/api/dnd/ui/dnd.css"><style>html,body{height:100%;margin:0}</style>'
      + '<div id="app"><div id="initiative"><span class="round" id="roundLbl">Round 1 · Ambush on the Coast Road<small>Party: 1 ALIVE · Enemies: 3/3</small></span>'
      + ['Ilsa', 'Goblin', 'Goblin archer', 'Wolf', 'Bandit', 'Bandit captain', 'Cultist', 'Ogre'].map((n) => `<div class="init-chip"><div class="face"></div><span class="nm">${n}</span></div>`).join('')
      + '</div><div id="playfield"><div id="stage"><div id="banner">Previously on… · the full recap is in Story</div>'
      + '<button class="fab" id="gamesBtn">☰ Games</button><button class="fab" id="savesBtn">⏳ Timeline</button><button class="fab" id="partyBtn">🧙 Party</button>'
      + '<button class="fab primary-fab" id="fullscreenBtn">⛶ PLAY FULL SCREEN</button><button class="fab" id="voiceBtn">⚙ DM Settings</button><button class="fab" id="storyBtn">💬 DM &amp; Story</button></div></div></div>',
    check: async (page) => {
      const r = await page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { title: document.getElementById('roundLbl').getBoundingClientRect().width,
          covers: ['gamesBtn', 'savesBtn', 'partyBtn', 'fullscreenBtn', 'voiceBtn', 'storyBtn'].filter((id) => hit(box('banner'), box(id))) };
      });
      assert.ok(r.title >= 100, `the table title is squeezed to ${Math.round(r.title)}px`);
      assert.deepEqual(r.covers, [], 'the recap banner covers table buttons');
    } },
  { name: 'feeds', url: '/api/feeds/dashboard', file: 'feeds/tools/feeds.html', view: PHONE,
    reads: { '/api/feeds/messages': { connected: false, count: 0, messages: [], connectUrl: '/api/connect/slack/start', error: 'not connected' }, '/api/feeds/settings': {} },
    posts: { '/api/feeds/sync': { status: 409, body: { error: 'not connected', detail: 'Slack is not connected for this account: connect Slack, then sync again.' } } },
    check: async (page) => {
      const drawer = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('drawer')); return { visibility: s.visibility, shadow: s.boxShadow }; });
      assert.equal(drawer.visibility, 'hidden', 'the closed drawer stays visible to the browser');
      assert.equal(drawer.shadow, 'none', 'the closed drawer casts a shadow band on the screen edge');
      await page.click('#syncBtn');
      const note = page.getByText(/Slack is not connected, so there is nothing to sync/);
      await note.waitFor({ timeout: 3000 });
      const box = await note.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= PHONE.height, 'the sync result is off-screen');
    } },
];

function serve(screen) {
  const app = express();
  const writes = [];
  app.use(express.json());
  for (const [route, answer] of Object.entries(screen.posts || {})) app.post(route, (_req, res) => res.status(answer.status).json(answer.body));
  for (const [route, fn] of Object.entries(screen.deletes || {})) app.delete(route, (req, res) => res.json(fn(req.params.id)));
  app.use((req, res, next) => { if (req.method !== 'GET') { writes.push(`${req.method} ${req.path}`); return res.status(405).json({ error: 'read-only fixture' }); } next(); });
  app.get(screen.url, (_req, res) => (screen.html ? res.type('html').send(screen.html) : res.sendFile(path.join(store, screen.file))));
  for (const [route, file] of Object.entries(screen.files || {})) app.get(route, (_req, res) => res.sendFile(path.join(store, file)));
  for (const [route, file] of Object.entries(screen.modules || {})) app.get(route, (_req, res) => res.type('application/javascript').send(file));
  for (const [route, body] of Object.entries(screen.reads)) app.get(route, (_req, res) => res.json(typeof body === 'function' ? body() : body));
  for (const [prefix, dir] of Object.entries(screen.dir || {})) app.use(prefix, express.static(path.join(store, dir)));
  app.get(/^\/shared\/ui\/.*\.css$/, (_req, res) => res.type('text/css').send(''));
  app.get(/^\/(shared\/ui|api\/artifacts|cockpit\/js)\/.*\.js$/, (_req, res) => res.type('application/javascript').send(''));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'synthetic endpoint unavailable' }));
  return new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve({ server, writes, origin: `http://127.0.0.1:${server.address().port}` })); });
}

async function runOne(browser, screen, failures) {
  const { server, writes, origin } = await serve(screen);
  const context = await browser.newContext({ viewport: screen.view, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss());
  try {
    if (screen.init) await screen.init(page);
    await page.goto(origin + screen.url, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await screen.check(page);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= screen.view.width, `${screen.name} is ${width}px wide at ${screen.view.width}px`);
    assert.deepEqual(writes, [], `${screen.name}: the screen wrote nothing it was not asked to`);
    console.log(`ok   ${screen.name}`);
  } catch (err) {
    failures.push(screen.name);
    console.log(`FAIL ${screen.name}: ${err.message.split('\n')[0]}`);
  } finally {
    if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, `${screen.name}.png`) }).catch(() => {}); }
    await context.close();
    server.close();
  }
}

async function run() {
  const only = process.argv.slice(2);
  const screens = SCREENS.filter((s) => !only.length || only.includes(s.name));
  const browser = await chromium.launch();
  const failures = [];
  try { for (const screen of screens) await runOne(browser, screen, failures); } finally { await browser.close(); }
  if (failures.length) { console.log(`${failures.length} of ${screens.length} screens failed: ${failures.join(', ')}`); process.exit(1); }
  console.log(`${screens.length} screens pass`);
}
run().catch((err) => { console.error(err); process.exit(1); });
