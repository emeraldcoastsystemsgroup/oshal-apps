/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9, in a real browser at phone width (412x915) over the package's REAL compiled routes
 *   (routes/own-events.js, routes/home-summary.js, routes/event-time.js) on real express over loopback HTTP: an event added with
 *   the person's IANA zone is shown on the full page and in the Recorded work list as 'Fri, Nov 6, 2099, 6:00 PM CST', never as the
 *   raw UTC instant; the "Added in OSHAL" list offers Remove, which asks first (a dismissed dialog removes nothing) and on OK
 *   sends DELETE and the event is gone from the list and the summary. Red before: the page had no Remove and printed
 *   '2099-11-07T00:00:00.000Z / added in OSHAL'. Named seams: the in-memory pool (row ownership and SQL are proved on
 *   PostgreSQL in own-events-postgres.test.cjs), a signed-in caller stub for OIDC, and empty stand-ins for the shell's shared
 *   theme scripts and connected-action modules the page imports. Needs the store toolchain (express, playwright, chromium).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** Load a compiled route with only its declared dependencies. */
function load(file, deps) {
  const m = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', file), 'utf8'))((name) => {
    if (name in deps) return deps[name];
    throw new Error('unexpected require ' + name);
  }, m, m.exports);
  return m.exports;
}
const logger = { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) };
const time = load('event-time.js', {});
const own = load('own-events.js', { express, crypto: require('node:crypto'), '@/shared/logger': logger, './event-time': time });
const summary = load('home-summary.js', { express, '@/shared/logger': logger, './own-events': own });

/** One person's calendar_own_events rows, answering exactly the statements the routes send. */
function pool() {
  const rows = [];
  return { rows, async query(q, values) {
    const text = typeof q === 'string' ? q : q.text, v = typeof q === 'string' ? values : q.values;
    if (/^SELECT COUNT/.test(text)) return { rows: [{ n: String(rows.length) }] };
    if (/AND title = \$2 AND starts_at = \$3/.test(text)) return { rows: rows.filter((r) => r.title === v[1] && r.starts_at === v[2] && r.all_day === v[3]) };
    if (/^SELECT .* FROM calendar_own_events WHERE user_sub = \$1 AND starts_at >= \$2/.test(text)) return { rows: rows.filter((r) => r.starts_at >= v[1]) };
    if (/^INSERT INTO calendar_own_events/.test(text)) {
      const [, id, title, starts_at, ends_at, all_day, time_zone, location, notes, created_at] = v;
      rows.push({ id, title, starts_at, ends_at, all_day, time_zone, location, notes, created_at });
      return { rowCount: 1, rows: [] };
    }
    if (/^DELETE FROM calendar_own_events/.test(text)) {
      const at = rows.findIndex((r) => r.id === v[1]);
      if (at >= 0) rows.splice(at, 1);
      return { rowCount: at >= 0 ? 1 : 0, rows: [] };
    }
    if (/calendar_preparation_snapshots|calendar_meeting_briefs/.test(text)) return { rows: [] };
    throw new Error('pool cannot answer: ' + text.slice(0, 80));
  } };
}

/** The page and its real routes on loopback, as one signed-in person. */
async function serve(p) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'sweep10-person' }, isAuthenticated: () => true }; next(); });
  app.get('/api/calendar/review', (_req, res) => res.sendFile(path.join(ROOT, 'tools', 'review.html')));
  app.use('/api/calendar/events', own.createOwnEventsRoutes({ pool: p }));
  app.use('/api/calendar/home-summary', summary.createHomeSummaryRoutes({ pool: p }));
  app.get('/api/calendar/meeting-briefs', (_req, res) => res.json({ briefs: [] }));
  app.get(['/shared/ui/js/surface-theme.js', '/shared/ui/js/app-view.js'], (_req, res) => res.type('js').send(''));
  app.get(['/shared/ui/css/surface-themes.css', '/shared/ui/css/app-view.css'], (_req, res) => res.type('css').send(''));
  app.get('/cockpit/js/app-handoff.js', (_req, res) => res.type('js').send('export function receiveHandoff() {}'));
  app.get('/cockpit/js/app-workflows.js', (_req, res) => res.type('js').send('export async function mountConnectedActions() {}'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('an added event reads in its own zone and Remove asks first, then takes it off the page', async (t) => {
  const p = pool();
  const { server, base } = await serve(p);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)); });
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })).newPage();
  const added = await page.request.post(`${base}/api/calendar/events`, { data: { title: 'sweep10 Denver drive', start: '2099-11-06T18:00', timeZone: 'America/Chicago', confirm: true } });
  assert.equal(added.status(), 201);
  await page.goto(`${base}/api/calendar/review`);
  const own = page.locator('#ownEvents');
  await own.getByText('sweep10 Denver drive').waitFor();
  assert.match(await own.innerText(), /Fri, Nov 6, 2099, 6:00 PM CST/);
  const records = await page.locator('#records').innerText();
  assert.match(records, /Fri, Nov 6, 2099, 6:00 PM CST \/ added in OSHAL/);
  assert.doesNotMatch(records + (await own.innerText()), /T\d{2}:\d{2}:\d{2}\.\d{3}Z/, 'no raw UTC instant on the page');
  const remove = own.getByRole('button', { name: 'Remove sweep10 Denver drive from your OSHAL calendar' });
  page.once('dialog', (d) => { assert.match(d.message(), /Remove "sweep10 Denver drive" \(Fri, Nov 6, 2099, 6:00 PM CST\)/); d.dismiss(); });
  await remove.click();
  await page.waitForTimeout(200);
  assert.equal(p.rows.length, 1, 'a dismissed dialog removes nothing');
  page.once('dialog', (d) => d.accept());
  await remove.click();
  await page.locator('#ownStatus').getByText('Removed "sweep10 Denver drive".').waitFor();
  assert.equal(p.rows.length, 0);
  assert.match(await own.innerText(), /Nothing added here yet/);
  assert.doesNotMatch(await page.locator('#records').innerText(), /sweep10 Denver drive/);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 412, `no horizontal scroll at phone width (scrollWidth ${width})`);
});
