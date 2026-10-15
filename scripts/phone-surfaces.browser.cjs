/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone-width (412 x 915) proof for the second sweep's store surfaces (2026-10-11), in headless Chromium against the real page files with synthetic read answers and no provider call. Readable theme: Travel, Movies and Spotify embedded in a cockpit that names --text-primary but no --bg-primary (the native cockpit) keep their own matched palette instead of near-white text on a light page. Width: the Switchboard variant cards and their Publish button, Embodied (and its watermark clear of the caption), the Kalshi tab strip (Settings on screen), the Circuit Lab header, Camera Ops, the Developer Workspace Index setting line and the D&D initiative strip fit 412px (its labels never print over a neighbour, and the phone full-screen button draws its icon). Hand-offs: Animatronics, Drone Relay and Circuit Lab mount their declared offer and hand on nothing while nothing is open. Honest states: Drone Ops says planning needs a fence and refuses the tap aloud, Kalshi does not promise a snapshot an installation that cannot scan will never make and hides its offers with no alert, Movies and Spotify hide offers while not connected, "Write variants" says why with no network, Portrait Studio's provider banner sits above the composer, Brand Graphics switches Render off with no Vids worker, and Vids Studio says what a worker is.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The same readable-theme proof for Feeds, Payments (a Life tab), Eats, Purchasing and Rides: each copied the native cockpit's --text-primary without a --bg-primary, so Feeds and Payments drew near-white text on a light page in the cockpit.
 * -----------------------------------------------------------------------------
 *
 * Usage: node scripts/phone-surfaces.browser.cjs              (every screen)
 *        node scripts/phone-surfaces.browser.cjs kalshi drone (named screens)
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
  console.error('phone-surfaces: no toolchain with playwright (npm ci --prefix scripts/toolchain, or set STORE_CI_TOOLCHAIN)');
  process.exit(2);
}
const express = require(path.join(toolchain, 'express'));
const { chromium } = require(path.join(toolchain, 'playwright'));

const WIDTH = 412;
/** A cockpit-module stand-in that records the mount and exposes contextForOffer. */
const WORKFLOWS_STUB = 'export async function mountConnectedActions(o){window.__mounted=o.app;window.__contextForOffer=o.contextForOffer;}';
const HANDOFF_STUB = 'export function receiveHandoff(){}';
const MODULES = { '/cockpit/js/app-workflows.js': WORKFLOWS_STUB, '/cockpit/js/app-handoff.js': HANDOFF_STUB };
/** The native cockpit's tokens: a dark text colour and NO --bg-primary. */
const NATIVE_COCKPIT = '<!doctype html><style>:root{--text-primary:#f8fafc;--bg-base:#07090e}body{margin:0;background:#07090e}</style>'
  + '<iframe id="f" style="width:412px;height:900px;border:0"></iframe><script>document.getElementById("f").src=location.search.slice(1)</script>';

/** The template literal named `name` in a route source, served as the page (no interpolation in these pages). */
function literal(file, name) {
  const src = fs.readFileSync(path.join(store, file), 'utf8');
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(src);
  assert.ok(m && !m[1].includes('${'), `${name} in ${file}`);
  return m[1].replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

/** Width of the page and of every element that crosses the right edge. */
async function overflow(page) {
  return page.evaluate((w) => {
    const over = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
      .map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''));
    return { scrollWidth: document.documentElement.scrollWidth, over: over.slice(0, 5) };
  }, WIDTH);
}
async function fits(page, label) {
  const m = await overflow(page);
  assert.ok(m.scrollWidth <= WIDTH, `${label} is ${m.scrollWidth}px wide at ${WIDTH}px (${m.over.join(', ')})`);
}
/** The palette a framed page ends up with inside the native cockpit. */
async function framedColors(page, selector) {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForLoadState('load');
  await page.waitForTimeout(400);
  return frame.evaluate((sel) => { const e = document.querySelector(sel); return { text: getComputedStyle(e).color, bg: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() }; }, selector);
}
function themed(name, url, file, selector) {
  return { name, url: '/cockpit-native', html: NATIVE_COCKPIT, query: url, files: { [url]: file }, reads: {},
    check: async (page) => {
      const c = await framedColors(page, selector);
      assert.notEqual(c.root, '#f8fafc', `${name}: --text took the cockpit's text colour without its background`);
      assert.notEqual(c.text, 'rgb(248, 250, 252)', `${name}: near-white text on its own page background ${c.bg}`);
    } };
}

const SCREENS = [
  themed('travel-theme', '/api/travel/app', 'travel/tools/travel-app.html', 'h1'),
  themed('movies-theme', '/api/movies/app', 'movies/tools/movies-app.html', 'h1, h2'),
  themed('spotify-theme', '/api/spotify/app', 'spotify/tools/spotify-app.html', 'h1, h2'),
  themed('feeds-theme', '/api/feeds/dashboard', 'feeds/tools/feeds.html', 'h1'),
  themed('payments-theme', '/api/payments/', 'payments/tools/payments.html', 'h1'),
  themed('eats-theme', '/api/eats/app', 'eats/tools/eats-app.html', 'h1, h2'),
  themed('purchasing-theme', '/api/purchasing/app', 'purchasing/tools/shopping-chat.html', 'h1'),
  themed('rides-theme', '/api/rides/app', 'rides/tools/rides-app.html', 'h1'),
  { name: 'switchboard-compose', url: '/api/switchboard/compose', file: 'switchboard/tools/switchboard-compose.html',
    reads: { '/api/switchboard/compose/targets': { targets: [{ platform: 'x', label: 'X', limit: 280, publishable: true, connected: false, inWorkspace: true }, { platform: 'linkedin', label: 'LinkedIn', limit: 3000, publishable: true, connected: false, inWorkspace: true }] }, '/api/switchboard/workspaces': { workspaces: [] } },
    posts: { '/api/switchboard/compose/variants': { variants: [
      { platform: 'x', label: 'X', limit: 280, publishable: true, text: 'We shipped a phone-friendly compose screen today. '.repeat(4) },
      { platform: 'linkedin', label: 'LinkedIn', limit: 3000, publishable: true, text: 'Long form. '.repeat(30) }] } },
    check: async (page) => {
      await page.fill('#src', 'We shipped a phone-friendly compose screen today.');
      await page.click('#genBtn');
      assert.match(await page.locator('#variantsWrap').innerText(), /Pick at least one network/, '"Write variants" with no network says why');
      await page.locator('#plats .plat').nth(0).click(); await page.locator('#plats .plat').nth(1).click();
      await page.click('#genBtn'); await page.waitForSelector('.vcard .pubbtn');
      const pub = await page.evaluate(() => [...document.querySelectorAll('.vcard .pubbtn')].map((b) => b.getBoundingClientRect().right));
      assert.ok(pub.every((r) => r <= WIDTH), `Publish is on screen (${pub})`);
      await fits(page, 'compose with variants');
    } },
  { name: 'embodied', url: '/api/embodied/app', file: 'embodied/tools/embodied.html', dir: { '/api/embodied/assets': 'embodied/tools' }, reads: {},
    check: async (page) => {
      await fits(page, 'Embodied');
      const r = await page.evaluate(() => {
        const mark = document.querySelector('.watermark').getBoundingClientRect(), cap = document.querySelector('canvas#view3d').closest('section').querySelector('h2').getBoundingClientRect();
        return { markTop: mark.top, capBottom: cap.bottom };
      });
      assert.ok(r.markTop >= r.capBottom, `the watermark (top ${r.markTop}) sits on the caption (bottom ${r.capBottom})`);
    } },
  { name: 'kalshi', url: '/api/kalshi/', file: 'kalshi/tools/kalshi.html', modules: MODULES,
    reads: { '/api/kalshi/scan': {
      awaitingFirstScan: true, generatedAt: null, hands: [], scorecard: [], exchangeActive: false,
      scan: { enabled: true, running: false, stale: true, unavailable: 'No Kalshi market feed is connected on this installation.', lastError: 'No Kalshi market feed is connected on this installation.', schedule: { app: 'kalshi', name: 'background-scan' } } },
    '/api/kalshi/alerts': { alerts: [], record: {} }, '/api/v1/agent/schedules': { schedules: [] } },
    check: async (page) => {
      await page.waitForFunction(() => document.getElementById('awaiting-banner').style.display !== 'none');
      await fits(page, 'Kalshi');
      const r = await page.evaluate(() => ({ settings: [...document.querySelectorAll('.tab')].pop().getBoundingClientRect().right, head: document.getElementById('awaiting-banner').innerText,
        empty: getComputedStyle(document.getElementById('empty')).display, review: document.getElementById('marketReview').hidden }));
      assert.ok(r.settings <= WIDTH, `the Settings tab ends at ${r.settings}px`);
      assert.ok(!/hasn't produced its first snapshot/.test(r.head), `an installation that cannot scan is promised a snapshot: ${r.head}`);
      assert.match(r.head, /Nothing has been scanned on this installation/);
      assert.equal(r.empty, 'none', '"the evaluator folds every market" is not claimed over markets nobody scanned');
      assert.equal(r.review, true, 'no alert to continue from, so the hand-off offers are hidden');
    } },
  { name: 'circuit-lab', url: '/api/circuit-lab/app', file: 'circuit-lab/tools/circuit-lab.html', dir: { '/api/circuit-lab/assets': 'circuit-lab/tools' }, modules: MODULES,
    reads: { '/api/circuit-lab/designs': { designs: [] } },
    check: async (page) => {
      await fits(page, 'Circuit Lab');
      await page.waitForFunction(() => window.__mounted === 'circuit-lab');
      assert.equal(await page.evaluate(() => window.__contextForOffer('prepare-document')), null, 'no circuit open: nothing to hand on');
      assert.equal(await page.evaluate(() => !!document.querySelector('#design-panel #labActions')), true, 'the offer lives in the open circuit panel');
    } },
  { name: 'camera', url: '/api/camera/app', file: 'camera/tools/camera-ops.html',
    reads: { '/api/camera/fleet': { configured: false, native: true, reason: 'no_camera_node', fleet: [], detail: 'No camera node is registered with this native runtime, so there are no cameras to show.' } },
    check: async (page) => { await page.waitForTimeout(800); await fits(page, 'Camera Ops'); } },
  { name: 'animatronics-handoff', url: '/api/animatronics/app', file: 'animatronics/tools/animatronics.html', dir: { '/api/animatronics/assets': 'animatronics/tools' }, modules: MODULES,
    reads: { '/api/animatronics/rigs': { rigs: [] }, '/api/animatronics/templates': { templates: [] } },
    check: async (page) => {
      await page.waitForFunction(() => window.__mounted === 'animatronics');
      assert.equal(await page.evaluate(() => window.__contextForOffer('prepare-document')), null, 'no rig open: nothing to hand on');
      assert.equal(await page.evaluate(() => !!document.querySelector('#editor #buildActions')), true);
    } },
  { name: 'drone-relay-handoff', url: '/api/drone-relay/app', file: 'drone-relay/tools/drone-relay.html', dir: { '/api/drone-relay/assets': 'drone-relay/tools' }, modules: MODULES,
    reads: { '/api/drone-relay/plans': { plans: [] }, '/api/drone-relay/transports': { transports: [] } },
    check: async (page) => {
      await page.waitForFunction(() => window.__mounted === 'drone-relay');
      assert.equal(await page.evaluate(() => window.__contextForOffer('prepare-document')), null, 'no chain open: nothing to hand on');
      assert.equal(await page.evaluate(() => !!document.querySelector('#plan-panel #briefActions')), true);
    } },
  { name: 'drone-planning', url: '/api/drone/app', file: 'drone/tools/drone-ops.html',
    reads: { '/api/drone/fleet': { fleet: [], fence: null, configured: false, native: true, reason: 'no_drone_node', detail: 'No drone or flight simulator is registered.' }, '/api/drone/missions': { missions: [] }, '/api/drone/show/status': { active: false, phase: 'idle', drones: [] }, '/api/drone/conversation': { messages: [] } },
    check: async (page) => {
      await page.waitForFunction(() => !document.getElementById('noDroneBanner').hidden);
      const box = await page.locator('#map').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ banner: document.getElementById('noDroneBanner').innerText, toast: (document.getElementById('toast') || document.querySelector('.toast') || {}).innerText || '', save: document.querySelector('button[onclick="saveMission()"]').disabled }));
      assert.ok(!/you can still plan and save missions/i.test(r.banner), `the banner promises planning with no fence: ${r.banner}`);
      assert.match(r.banner, /Planning needs a geofence and a home position/);
      assert.match(r.toast, /Planning needs a geofence/, 'a map tap with no fence says why instead of vanishing');
      assert.equal(r.save, true, 'Save mission is off: the server validates every mission against the fence');
    } },
  { name: 'movies-offers', url: '/api/movies/app', file: 'movies/tools/movies-app.html', modules: MODULES, reads: { '/api/movies/config': { connected: false } },
    check: async (page) => {
      await page.waitForFunction(() => window.__mounted === 'movies');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.connected-app-actions')).display), 'none', 'not connected and no draft: no offers');
    } },
  { name: 'spotify-offers', url: '/api/spotify/app', file: 'spotify/tools/spotify-app.html', modules: MODULES, reads: { '/api/spotify/config': { connected: false } },
    check: async (page) => {
      await page.waitForFunction(() => window.__mounted === 'spotify');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.connected-app-actions')).display), 'none', 'not connected and no draft: no offers');
    } },
  { name: 'portrait-banner', url: '/api/portrait-studio/app', file: 'portrait-studio/tools/portrait-studio.html',
    files: { '/api/portrait-studio/capture-module': 'portrait-studio/tools/portrait-capture.js', '/api/portrait-studio/face-module': 'portrait-studio/tools/portrait-face.js' },
    reads: { '/api/portrait-studio/permissions': { permissions: { view: true, read: true, create: true, email: true }, unavailable: { email: true } }, '/api/portrait-studio/catalog': { modes: {}, styles: [] }, '/api/portrait-studio/portraits': { portraits: [] },
      '/api/portrait-studio/provider': { configured: false, provider: 'native-unconfigured', unavailable: 'portrait_provider_unavailable' } },
    check: async (page) => {
      await page.waitForFunction(() => getComputedStyle(document.getElementById('providerBanner')).display !== 'none');
      const r = await page.evaluate(() => ({ banner: document.getElementById('providerBanner').getBoundingClientRect().top, gen: document.getElementById('generateBtn').getBoundingClientRect().top, composer: document.getElementById('studioComposer').getBoundingClientRect().top, access: document.getElementById('accessBanner').innerText }));
      assert.ok(r.banner < r.composer && r.banner < WIDTH * 2, `the provider banner is at y=${r.banner}, after the composer (${r.composer})`);
      assert.ok(!/role|broker|issuer/i.test(r.access), `jargon in the access banner: ${r.access}`);
    } },
  { name: 'brand-graphics-render', url: '/api/brand-graphics/review', file: 'brand-graphics/tools/review.html', modules: MODULES,
    reads: { '/api/vids/jobs': { jobs: [], workers: [] }, '/api/brand-graphics/home-summary': { metrics: [], items: [] } },
    check: async (page) => {
      await page.waitForFunction(() => document.getElementById('render').disabled);
      assert.match(await page.locator('#renderHint').innerText(), /no Vids worker is registered/);
    } },
  { name: 'vids-worker', url: '/api/vids/app', html: () => literal('vids/routes/vids-routes.js', 'SURFACE_HTML'), reads: { '/api/vids/jobs': { jobs: [], workers: [] } },
    check: async (page) => {
      await page.waitForFunction(() => !document.getElementById('whint').hidden);
      assert.match(await page.locator('#whint').innerText(), /npx oshal-vids worker/);
      assert.equal(await page.locator('#go').isDisabled(), true);
    } },
  // The initiative strip as table-dock.js renders it (face, name, role label, hp), eight combatants with long roles.
  { name: 'dnd-initiative', url: '/api/dnd/table', file: 'dnd/ui/table.html', dir: { '/api/dnd': 'dnd/ui' }, reads: {},
    check: async (page) => {
      const r = await page.evaluate(() => {
        const bar = document.getElementById('initiative');
        const chip = (nm, role) => `<div class="init-chip"><span class="glyph">@</span><span class="nm">${nm}</span><span class="controller">${role}</span><span class="hp">7/7</span></div>`;
        bar.innerHTML = '<span class="round">Round 1<small>Fight</small></span>' + [['Snaggletooth', 'Goblin boss'], ['Vesh', 'Ambush archer'], ['Fenwick', 'AI companion'], ['Della', 'AI companion'],
          ['Bram', 'You'], ['Tallow', 'Cart cutter'], ['Pip', 'AI companion'], ['Rikkit', 'Road skirmisher']].map(([n, r]) => chip(n, r)).join('');
        const labels = [...bar.querySelectorAll('.nm, .controller')].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: Math.round(b.top) }; });
        let overlaps = 0;
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) { const x = labels[i], y = labels[j]; if (x.t === y.t && x.l < y.r - 0.5 && y.l < x.r - 0.5) overlaps += 1; }
        const icon = getComputedStyle(document.getElementById('fullscreenBtn'), '::after').backgroundImage;
        return { overlaps, icon };
      });
      assert.equal(r.overlaps, 0, `${r.overlaps} initiative labels print over a neighbour`);
      assert.match(r.icon, /^url\(/, 'the phone full-screen button draws its icon (phone fonts have no U+26F6)');
      await fits(page, 'the D&D table');
    } },
  { name: 'dev-workspace-index', url: '/api/dev-workspace-index/app', html: () => literal('dev-workspace-index/routes/dev-workspace.js', 'APP_HTML'),
    reads: { '/api/dev-workspace-index/dev-mode': { devConsoleEnabled: false, devMode: { enabled: false }, packageEnabled: false, reason: 'dev_console_disabled', superAdmin: true,
      settings: { devConsole: 'OSHAL_PACKAGE_ENV_DEV_WORKSPACE_INDEX__DEV_CONSOLE_ENABLED', package: 'OSHAL_PACKAGE_ENV_DEV_WORKSPACE_INDEX__DEV_WORKSPACE_INDEX_ENABLED' } } },
    check: async (page) => {
      await page.waitForFunction(() => /OSHAL_PACKAGE_ENV/.test(document.getElementById('state').innerText));
      await fits(page, 'Developer Workspace Index');
    } },
];

/** Serve one screen: its page, static files, synthetic reads and posts, stand-ins for the shared kit. */
function serve(screen) {
  const app = express();
  const writes = [];
  app.use(express.json());
  for (const [route, body] of Object.entries(screen.posts || {})) app.post(route, (_req, res) => res.json(body));
  app.use((req, res, next) => { if (req.method !== 'GET') { writes.push(`${req.method} ${req.path}`); return res.status(405).json({ error: 'read-only fixture' }); } next(); });
  const page = screen.html ? (typeof screen.html === 'function' ? screen.html() : screen.html) : null;
  app.get(screen.url, (_req, res) => (page ? res.type('html').send(page) : res.sendFile(path.join(store, screen.file))));
  for (const [route, file] of Object.entries(screen.files || {})) app.get(route, (_req, res) => res.sendFile(path.join(store, file)));
  for (const [route, file] of Object.entries(screen.modules || {})) app.get(route, (_req, res) => res.type('application/javascript').send(file));
  for (const [route, body] of Object.entries(screen.reads)) app.get(route, (_req, res) => res.json(body));
  for (const [prefix, dir] of Object.entries(screen.dir || {})) app.use(prefix, express.static(path.join(store, dir)));
  app.get(/^\/shared\/ui\/.*\.css$/, (_req, res) => res.type('text/css').send(''));
  app.get(/^\/(shared\/ui|api\/artifacts|cockpit\/js)\/.*\.js$/, (_req, res) => res.type('application/javascript').send(''));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'synthetic endpoint unavailable' }));
  return new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve({ server, writes, origin: `http://127.0.0.1:${server.address().port}` })); });
}

async function runOne(browser, screen, failures) {
  const { server, writes, origin } = await serve(screen);
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss());
  try {
    await page.goto(origin + screen.url + (screen.query ? '?' + screen.query : ''), { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await screen.check(page);
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
  console.log(`${screens.length} screens pass at ${WIDTH}px`);
}
run().catch((err) => { console.error(err); process.exit(1); });
