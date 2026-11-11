/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.5.0: Finance opens as its own application. The manifest makes the application page the first and default
 *     |                                             | screen and keeps every earlier screen under its own name; the route serves the page; the page's own words for
 *     |                                             | a job's rhythm, a summary tile and a job's name are right for the schedules and tiles production really has;
 *     |                                             | its sections come from the menu the server sends, never the page itself or an address on another site; and
 *     |                                             | the page only reads (no request other than GET, nothing switched on).
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'tools', 'finance-app.html'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'routes', 'finance-routes.js'), 'utf8');

/** The page's own helpers, from its own script, with no browser. */
function helpers() {
  const script = page.match(/<script>\s*\(function \(\) \{[\s\S]*?<\/script>/)[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  const window = {};
  const document = { readyState: 'loading', addEventListener() {}, getElementById: () => ({}), querySelectorAll: () => [] };
  vm.runInNewContext(script, { window, document, location: { hash: '' }, history: {}, fetch: () => Promise.reject(new Error('no network in this test')) });
  return window.FinanceApp;
}

test('the application page is the first and default screen, and every earlier screen keeps its name and address', () => {
  assert.match(manifest, /^version: 1\.5\.0$/m);
  const ui = manifest.slice(manifest.indexOf('\nui:\n'), manifest.indexOf('\nribbon:\n'));
  const tools = [...ui.matchAll(/- toolName: (\S+)\n\s+label: (.+)\n\s+icon: .+\n\s+iframeUrl: (\S+)\n\s+section: (\S+)/g)].map((m) => [m[1], m[2], m[3], m[4]]);
  assert.deepEqual(tools, [
    ['finance-app', 'Finance', '/api/finance/app', 'top'],
    ['finance-home', 'Money', '/api/finance/', 'top'],
    ['finance-banks', 'Linked banks', '/api/finance/?view=banks', 'bottom'],
    ['finance-trading', 'Intelligent Trades', '/api/trading/', 'top'],
    ['finance-world', 'World Intelligence', '/api/world/app', 'top'],
    ['finance-kalshi', 'Kalshi Edge', '/api/kalshi/', 'top'],
    ['finance-recap', 'Daily recap', '/api/daily-trade-recap/review', 'top'],
  ]);
  assert.match(manifest, /^ {2}defaultView: finance-app$/m);
  assert.match(manifest, /surface: finance-home/, 'what other applications hand to the overview still names finance-home');
});

test('the route serves the page', () => {
  assert.match(routes, /router\.get\('\/app', servePage\(surfaceDir, 'finance-app\.html'\)\);/);
  assert.ok(fs.statSync(path.join(ROOT, 'tools', 'finance-app.html')).size > 4000);
  assert.match(page, /<title>Finance<\/title>/);
});

test('a job\'s rhythm is said in words for every schedule the finance jobs really have', () => {
  const { rhythm } = helpers();
  assert.equal(rhythm('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(rhythm('* * * * *'), 'Every minute');
  assert.equal(rhythm('5 17 * * 1-5'), 'Once a day, on trading days');
  assert.equal(rhythm('*/5 9-15 * * 1-5'), 'Every 5 minutes in its daily window, on trading days');
  assert.equal(rhythm('20-55/5 17 * * 1-5'), 'Every 5 minutes, on trading days');
  assert.equal(rhythm('* 17-23 * * 1-5'), 'Every minute in its daily window, on trading days');
  assert.equal(rhythm('15 2 * * 2-6'), 'Once a day, on trading days');
  assert.equal(rhythm('0 * * * *'), 'Every hour');
  assert.equal(rhythm('15 9 * * 0'), 'Once a day, on set days');
  assert.equal(rhythm(''), 'On its own schedule');
  assert.equal(rhythm('not a schedule at all'), 'On its own schedule');
});

test('a tile shows a net worth as money, a time as a time, and anything else as it came', () => {
  const { tileValue } = helpers();
  assert.deepEqual({ ...tileValue('{"assets":86541.74,"liabilities":163705.89,"net":-77164.15}') }, { big: '−$77,164', small: '$86,542 owned · $163,706 owed' });
  assert.deepEqual({ ...tileValue('{"net":1200}') }, { big: '$1,200', small: '' });
  assert.deepEqual({ ...tileValue('3') }, { big: '3', small: '' });
  assert.deepEqual({ ...tileValue('sandbox') }, { big: 'sandbox', small: '' });
  assert.deepEqual({ ...tileValue(null) }, { big: '—', small: '' });
  assert.deepEqual({ ...tileValue('{not json') }, { big: '{not json', small: '' });
  const time = tileValue('2026-11-06T05:55:00.941Z');
  assert.ok(/\d{1,2}:\d{2}/.test(time.big) && !/T05:55/.test(time.big), `a saved time reads as a time: ${time.big}`);
});

test('a job is named in plain words', () => {
  const { jobName } = helpers();
  assert.equal(jobName({ name: 'paper-autopilot' }), 'Paper autopilot');
  assert.equal(jobName({ name: 'oshal-daily-report' }), 'Daily report');
  assert.equal(jobName({ name: 'daily-trade-recap-recorded-reports' }), 'Recorded reports');
  assert.equal(jobName({ name: 'background-scan' }), 'Background scan');
  assert.equal(jobName({}), 'Job');
});

test('sections come from the menu the server sends: not this page itself, and never an address on another site', () => {
  const { sectionsOf } = helpers();
  const item = (id, label, iframeUrl, section = 'top') => ({ id: `tool-${id}`, label, section, toolUi: { iframeUrl } });
  const got = sectionsOf({ profile: { ribbon: { items: [
    item('finance-app', 'Finance', '/api/finance/app'), item('finance-home', 'Money', '/api/finance/'),
    item('finance-banks', 'Linked banks', '/api/finance/?view=banks', 'bottom'), item('finance-trading', 'Intelligent Trades', '/api/trading/'),
    item('finance-new-thing', 'A new screen', '/api/finance/new'), item('finance-elsewhere', 'Elsewhere', 'https://example.com/x'),
    item('finance-slashes', 'Slashes', '//example.com/x'), { id: 'tool-no-page', label: 'No page' },
  ] } } });
  assert.deepEqual(got.map((s) => [s.name, s.label, s.full, s.url, s.more]), [
    ['finance-home', 'Money', 'Money', '/api/finance/', false],
    ['finance-banks', 'Banks', 'Linked banks', '/api/finance/?view=banks', true],
    ['finance-trading', 'Trades', 'Intelligent Trades', '/api/trading/', false],
    ['finance-new-thing', 'A new screen', 'A new screen', '/api/finance/new', false],
  ]);
  assert.deepEqual([...sectionsOf(null)], []);
  assert.deepEqual([...sectionsOf({ profile: {} })], []);
});

test('the page only reads: every request is a GET and nothing is switched on from it', () => {
  assert.doesNotMatch(page, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(page, /\/activate|\/trigger|\/deactivate|\/orders|\/pay\b/);
  const reads = [...page.matchAll(/getJson\((['"])([^'"]+)\1/g)].map((m) => m[2]);
  assert.deepEqual(reads.sort(), ['/api/swarm/roles/me', '/api/ui/profile?name=finance', '/api/v1/agent/schedules']);
  assert.match(page, /summary: '\/api\/finance\/home-summary'/);
  assert.match(page, /summary: '\/api\/trading\/home-summary'/);
  assert.match(page, /summary: '\/api\/kalshi\/home-summary'/);
  assert.match(page, /summary: '\/api\/daily-trade-recap\/home-summary'/);
});
