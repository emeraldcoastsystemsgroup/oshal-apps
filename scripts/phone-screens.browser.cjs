/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone-width (412 x 915) proof for the store screens a person reported broken on a phone (2026-10-11), in headless Chromium against the real page files, with synthetic read-only answers for each page's own routes and no provider call. Layout: Animatronics, Drone Relay and World never scroll sideways (World with a by-source table ~1,200px wide), E-STOP stays on screen, Drone Relay's results get the full width, D&D's floating toolbar buttons never overlap and its buttons painted on the dark wood keep at least 4.5:1 contrast under a light cockpit theme, and the Smart Home hand-off panel never sits on the Ask input or Send. Honest states: Spaces, Drone Ops, AI Bake-Off, Payments and Portrait Studio show the server's own reason for an unavailable executor and switch off what cannot run (never "Connect undefined", a raw refusal code, or a demo room that does not exist); Finance and Intelligent Trades (its real connected-actions module on the panel it binds to) open the draft panel and say what to write when a connected action has nothing to hand on.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Payments with a rail the server reports not configured (configured:false + detail, the native kernel's merchant rails): the reason is shown and there is no Connect link.
 * -----------------------------------------------------------------------------
 *
 * Usage: node scripts/phone-screens.browser.cjs            (every screen)
 *        node scripts/phone-screens.browser.cjs dnd home   (named screens)
 *        SHOTS=<dir> ...                                    (also save a screenshot per screen)
 * Needs the store toolchain (npm ci --prefix scripts/toolchain) for express and playwright, or STORE_CI_TOOLCHAIN.
 * The shared kit (/shared/ui) and cockpit modules are stood in for: the screens are proven on their own markup.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const store = path.resolve(__dirname, '..');
const toolchain = process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain', 'node_modules');
if (!fs.existsSync(path.join(toolchain, 'playwright'))) {
  console.error('phone-screens: no toolchain with playwright (npm ci --prefix scripts/toolchain, or set STORE_CI_TOOLCHAIN)');
  process.exit(2);
}
const express = require(path.join(toolchain, 'express'));
const { chromium } = require(path.join(toolchain, 'playwright'));

const WIDTH = 412;
const UNAVAILABLE = 'This installation has no fixture engine connected (fixture reason).';

/** A cockpit module stand-in that exposes the contextForOffer the page registers, so the test can call it. */
const WORKFLOWS_STUB = 'export async function mountConnectedActions(o){window.__contextForOffer=o.contextForOffer;}';
const HANDOFF_STUB = 'export function receiveHandoff(){}';

/** Every screen: its page file and URL, extra files, synthetic reads, and the check run in the page. */
const SCREENS = [
  { name: 'animatronics', url: '/api/animatronics/app', file: 'animatronics/tools/animatronics.html',
    dir: { '/api/animatronics/assets': 'animatronics/tools' }, reads: { '/api/animatronics/rigs': { rigs: [] }, '/api/animatronics/templates': { templates: [] } },
    check: async (page) => {
      const m = await metrics(page, '#estop');
      assert.ok(m.scrollWidth <= WIDTH, `page is ${m.scrollWidth}px wide at ${WIDTH}`);
      assert.ok(m.el.left >= 0 && m.el.right <= WIDTH, `E-STOP on screen (${m.el.left}..${m.el.right})`);
    } },
  { name: 'drone-relay', url: '/api/drone-relay/app', file: 'drone-relay/tools/drone-relay.html',
    dir: { '/api/drone-relay/assets': 'drone-relay/tools' }, reads: { '/api/drone-relay/plans': { plans: [] }, '/api/drone-relay/transports': { transports: [] } },
    check: async (page) => {
      const m = await metrics(page, 'main');
      assert.ok(m.scrollWidth <= WIDTH, `page is ${m.scrollWidth}px wide`);
      assert.ok(m.el.width >= WIDTH - 2, `results column is the full width, not ${m.el.width}px beside the form`);
    } },
  { name: 'world', url: '/api/world/app', file: null, render: () => require(path.join(store, 'world/routes/world-app-html.js')),
    reads: { '/api/world/entities': { entities: [] } },
    check: async (page) => {
      // The by-source ratings table: ~1,200px of nowrap cells, as the live dashboard renders it.
      await page.evaluate(() => {
        const row = '<tr><td>world:outlet:a-very-long-outlet-name-for-width</td><td>-0.07 below</td><td>0.95</td><td>55 compared subject-days, 28 subjects, 2026-07-23 to 2026-10-10</td><td>n</td><td>sentiment</td></tr>';
        document.getElementById('main').innerHTML = '<div class="card"><h3>By source</h3><table><thead><tr><th>Source</th><th>Lean</th><th>Reliability</th><th>Observed</th><th>n</th><th>Sentiment</th></tr></thead><tbody>' + row.repeat(6) + '</tbody></table></div>';
      });
      const m = await metrics(page, 'main');
      assert.ok(m.scrollWidth <= WIDTH, `dashboard is ${m.scrollWidth}px wide: the wide table must scroll inside its own box`);
    } },
  { name: 'dnd', url: '/api/dnd/table', file: 'dnd/ui/table.html', dir: { '/api/dnd': 'dnd/ui' }, reads: {},
    // A light cockpit theme: its text token is navy, which the dark wood buttons must not inherit.
    theme: ':root{--text-primary:#1f2433;--text-muted:#5b6475;--bg-card:#ffffff;}',
    check: async (page) => {
      const r = await page.evaluate(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return { id: e.id, l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const fabs = [...document.querySelectorAll('.fab')].filter((e) => getComputedStyle(e).display !== 'none' && e.offsetParent).map(box);
        const bigs = [...document.querySelectorAll('button.big:not(.ghost), .campaign-actions button, .save-row button, #talk button')].map((e) => ({ id: e.id || e.textContent.trim().slice(0, 20), color: getComputedStyle(e).color }));
        return { fabs, bigs, sw: document.documentElement.scrollWidth };
      });
      assert.ok(r.fabs.length >= 4, 'toolbar buttons are on the board');
      for (let i = 0; i < r.fabs.length; i++) for (let j = i + 1; j < r.fabs.length; j++) {
        const a = r.fabs[i], b = r.fabs[j];
        const overlap = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
        assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
      }
      assert.ok(r.bigs.length > 0, 'dark wood buttons are present');
      for (const b of r.bigs) assert.ok(contrast(b.color, 'rgb(58,42,21)') >= 4.5, `${b.id}: ${b.color} on the wood is ${contrast(b.color, 'rgb(58,42,21)').toFixed(2)}:1`);
    } },
  { name: 'home', url: '/api/home/ui', file: 'home/tools/home.html', reads: { '/api/home/devices': { devices: [] }, '/api/home/schedules': { schedules: [] } },
    check: async (page) => {
      const r = await page.evaluate(() => {
        const covered = (el) => { const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !(hit && (hit === el || el.contains(hit))); };
        return { msg: covered(document.getElementById('msg')), send: covered(document.getElementById('send')) };
      });
      assert.deepEqual(r, { msg: false, send: false }, 'the hand-off panel must not sit on the Ask input or Send');
    } },
  { name: 'spaces', url: '/api/spaces/app', file: 'spaces/tools/spaces.html',
    reads: { '/api/spaces/scans': { scans: [], configured: false, native: true, reason: 'no_reconstruction_engine', detail: UNAVAILABLE } },
    check: async (page) => {
      await page.waitForFunction(() => !document.getElementById('phase-note').hidden);
      const r = await page.evaluate(() => ({ note: document.getElementById('phase-note').innerText, off: ['submit-btn', 'import-btn', 'drone-scan-btn', 'guide-btn'].map((id) => document.getElementById(id).disabled) }));
      assert.ok(r.note.includes(UNAVAILABLE), `the server's reason is shown: ${r.note}`);
      assert.ok(!/synthetic demo room/i.test(r.note), 'no promise of a demo room that does not exist');
      assert.deepEqual(r.off, [true, true, true, true], 'capture controls are off');
    } },
  { name: 'drone', url: '/api/drone/app', file: 'drone/tools/drone-ops.html',
    reads: { '/api/drone/fleet': { fleet: [], fence: null, configured: false, native: true, reason: 'no_drone_node', detail: UNAVAILABLE }, '/api/drone/missions': { missions: [] }, '/api/drone/show/status': { active: false, phase: 'idle', drones: [] }, '/api/drone/conversation': { messages: [] } },
    check: async (page) => {
      await page.waitForFunction(() => !document.getElementById('noDroneBanner').hidden);
      const r = await page.evaluate(() => ({ banner: document.getElementById('noDroneBanner').innerText, pill: document.getElementById('providerPill').textContent, takeoff: document.querySelector('button[onclick="takeoff()"]').disabled }));
      assert.ok(r.banner.includes(UNAVAILABLE));
      assert.notEqual(r.pill, 'SIM', 'no SIM badge over a fleet that does not exist');
      assert.equal(r.takeoff, true);
    } },
  { name: 'bake-off', url: '/api/bake-off/', file: 'bake-off/tools/bake-off.html',
    reads: { '/api/bake-off/lanes': { lanes: [], configured: false, native: true, reason: 'no_distinct_lanes', detail: UNAVAILABLE, defaults: {}, limits: {} }, '/api/bake-off/jobs': { jobs: [] } },
    check: async (page) => {
      await page.waitForFunction(() => !/loading/.test(document.getElementById('lanes').innerText));
      const lanes = await page.locator('#lanes').innerText();
      assert.ok(lanes.includes(UNAVAILABLE), `lanes panel shows the reason: ${lanes}`);
      assert.equal(await page.locator('#run').isDisabled(), true);
    } },
  { name: 'payments', url: '/api/payments/', file: 'payments/tools/payments.html', reads: { '/api/payments/providers': { providers: [] }, '/api/payments/history': { charges: [] } },
    check: async (page) => {
      await page.waitForFunction(() => !document.querySelector('#main .spin'));
      const text = await page.locator('#main').innerText();
      assert.ok(!/undefined/.test(text), `no "undefined" on the page: ${text}`);
      assert.match(text, /No payment rail on this installation/);
    } },
  { name: 'payments-unconfigured', url: '/api/payments/', file: 'payments/tools/payments.html',
    reads: { '/api/payments/providers': { providers: [{ provider: 'square', connected: false, testMode: true, sourceLabel: 'Card token', configured: false, detail: UNAVAILABLE }] }, '/api/payments/history': { charges: [] } },
    check: async (page) => {
      await page.waitForFunction(() => !document.querySelector('#main .spin'));
      const text = await page.locator('#formPanel').innerText();
      assert.ok(text.includes(UNAVAILABLE), `the rail's reason is shown: ${text}`);
      assert.equal(await page.locator('#formPanel a[href*="/api/connect/"]').count(), 0, 'no Connect link to a connector that does not exist');
    } },
  { name: 'portrait-studio', url: '/api/portrait-studio/app', file: 'portrait-studio/tools/portrait-studio.html',
    files: { '/api/portrait-studio/capture-module': 'portrait-studio/tools/portrait-capture.js', '/api/portrait-studio/face-module': 'portrait-studio/tools/portrait-face.js' },
    reads: { '/api/portrait-studio/permissions': { permissions: { view: true, read: true, create: true } }, '/api/portrait-studio/catalog': { modes: {}, styles: [] }, '/api/portrait-studio/portraits': { portraits: [] },
      '/api/portrait-studio/provider': { configured: false, provider: 'native-unconfigured', unavailable: 'portrait_provider_unavailable', detail: 'the native-unconfigured image provider is not available to you' } },
    check: async (page) => {
      await page.waitForFunction(() => getComputedStyle(document.getElementById('providerBanner')).display !== 'none');
      const r = await page.evaluate(() => ({ banner: document.getElementById('providerBanner').innerText, btn: document.getElementById('generateBtn').textContent, disabled: document.getElementById('generateBtn').disabled }));
      assert.match(r.banner, /no image-generation provider is configured on this installation/);
      assert.ok(!/portrait_provider_unavailable|native-unconfigured/.test(r.banner + r.btn), 'no raw refusal code or internal provider id');
      assert.equal(r.disabled, true);
    } },
  { name: 'finance', url: '/api/finance/', file: 'finance/tools/finance.html', reads: { '/api/finance/status': { connected: 0, providers: [] } },
    modules: { '/cockpit/js/app-workflows.js': WORKFLOWS_STUB, '/cockpit/js/app-handoff.js': HANDOFF_STUB },
    check: async (page) => {
      await page.waitForFunction(() => typeof window.__contextForOffer === 'function');
      const r = await page.evaluate(async () => { try { await window.__contextForOffer('prepare-document'); return { threw: null }; } catch (e) { return { threw: e.message, panel: !document.getElementById('reviewPanel').hidden }; } });
      assert.match(r.threw || '', /Nothing on this screen to hand on yet/);
      assert.equal(r.panel, true, 'the draft panel opens so the work can be entered');
    } },
  // The real connected-actions module on the markup it binds to (trading.html's research draft panel and
  // actions section, with no research loaded); the full trading page needs a broker and market data.
  { name: 'intelligent-trades', url: '/api/trading/', file: null,
    html: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script>var VIEW="account",SUB="",RS_SYM="";</script>'
      + '<section id="researchDraftPanel" hidden><textarea id="researchDraft"></textarea><input id="researchTicker"><button id="researchDraftGo">Go</button><p id="researchDraftStatus"></p></section>'
      + '<section class="connected-app-actions"></section><script type="module" src="/api/trading/ui/connected-actions.js"></script>',
    dir: { '/api/trading/ui': 'trading/tools/ui' }, reads: {},
    modules: { '/cockpit/js/app-workflows.js': WORKFLOWS_STUB, '/cockpit/js/app-handoff.js': HANDOFF_STUB },
    check: async (page) => {
      await page.waitForFunction(() => typeof window.__contextForOffer === 'function');
      const r = await page.evaluate(async () => { try { await window.__contextForOffer('prepare-document'); return { threw: null }; } catch (e) { return { threw: e.message, panel: !document.getElementById('researchDraftPanel').hidden }; } });
      assert.match(r.threw || '', /Nothing on this screen to hand on yet/);
      assert.equal(r.panel, true, 'the research draft panel opens so the work can be written');
      const handed = await page.evaluate(async () => { document.getElementById('researchDraft').value = 'NVDA guidance notes'; return window.__contextForOffer('prepare-document'); });
      assert.deepEqual(handed, { title: 'Review my market research', notes: 'NVDA guidance notes' });
    } },
];

/** Relative luminance contrast of two rgb() colours. */
function contrast(fg, bg) {
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Page width and one element's box. */
async function metrics(page, selector) {
  return page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect();
    return { scrollWidth: document.documentElement.scrollWidth, el: { left: b.left, right: b.right, width: b.width } };
  }, selector);
}

/** Serve one screen: its page, its static files, synthetic reads, stand-ins for the shared kit. */
function serve(screen) {
  const app = express();
  const writes = [];
  app.use((req, res, next) => { if (req.method !== 'GET') { writes.push(`${req.method} ${req.path}`); return res.status(405).json({ error: 'read-only fixture' }); } next(); });
  app.get(screen.url, (_req, res) => (screen.file ? res.sendFile(path.join(store, screen.file)) : res.type('html').send(screen.html || screen.render().WORLD_APP_HTML)));
  for (const [route, file] of Object.entries(screen.files || {})) app.get(route, (_req, res) => res.type('application/javascript').sendFile(path.join(store, file)));
  for (const [route, file] of Object.entries(screen.modules || {})) app.get(route, (_req, res) => res.type('application/javascript').send(file));
  for (const [route, body] of Object.entries(screen.reads)) app.get(route, (_req, res) => res.json(body));
  for (const [prefix, dir] of Object.entries(screen.dir || {})) app.use(prefix, express.static(path.join(store, dir)));
  app.get(/^\/shared\/ui\/.*\.css$/, (_req, res) => res.type('text/css').send(''));
  app.get(/^\/(shared\/ui|api\/artifacts)\/.*\.js$/, (_req, res) => res.type('application/javascript').send(''));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'synthetic endpoint unavailable' }));
  return new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve({ server, writes, origin: `http://127.0.0.1:${server.address().port}` })); });
}

async function run() {
  const only = process.argv.slice(2);
  const screens = SCREENS.filter((s) => !only.length || only.includes(s.name));
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const screen of screens) {
      const { server, writes, origin } = await serve(screen);
      const context = await browser.newContext({ viewport: { width: WIDTH, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('dialog', (d) => d.dismiss());
      try {
        await page.goto(origin + screen.url, { waitUntil: 'load' });
        if (screen.theme) await page.addStyleTag({ content: screen.theme });
        await page.waitForTimeout(600);
        await screen.check(page);
        assert.deepEqual(writes, [], `${screen.name}: the screen wrote nothing on open`);
        console.log(`ok   ${screen.name}`);
      } catch (err) {
        failures.push(screen.name);
        console.log(`FAIL ${screen.name}: ${err.message}`);
      } finally {
        if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, `${screen.name}.png`) }).catch(() => {}); }
        await context.close();
        server.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) { console.log(`${failures.length} of ${screens.length} screens failed: ${failures.join(', ')}`); process.exit(1); }
  console.log(`${screens.length} screens pass at ${WIDTH}px`);
}

run().catch((err) => { console.error(err); process.exit(1); });
