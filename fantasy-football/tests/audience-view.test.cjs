/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, fed the JSON the REAL compiled route (routes/home-summary.js, loaded with a stub Router and pool) builds from database rows; the title follows the account state, partial reads and every refusal are said with no figure in their place, the only read is the home summary, and the page start is gated.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'fantasy-football';
const PAGE = 'tools/fantasy-football.html';
const AUDIENCES = ["company"];
const ALLOWED_PREFIXES = ["/api/fantasy-football"];
const GATE_FILE = 'tools/fantasy-football.html';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});

/**
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes. The stub formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead
 * (a body of undefined is not JSON); `{ reject: true }` fails the request itself (a network error).
 * @returns {{ company: Function, urls: string[], assigned: string[] }} The builder, every request made and every navigation.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.reject) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit, location: { pathname: '/api/fantasy-football/', assign: (u) => assigned.push(u) } }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls, assigned };
}

/**
 * @description Load the compiled route (routes/home-summary.js) with a stub Router and a stub pool, and answer one GET the
 * way Express would, so the view is fed exactly what the route builds from database rows.
 * @param {object|Error} leagues The leagues row (text column leagues), or an Error the query throws.
 * @param {object|Error} calls The calls row (text columns pending, graded), or an Error.
 * @param {boolean} [signedIn] Whether the session carries a sub (true by default).
 * @returns {Promise<object>} The body the view would read (after a JSON round trip), as `{ http, body }` when the route did not answer 200.
 */
async function fromRoute(leagues, calls, signedIn = true) {
  let handler = null;
  const deps = { express: { Router: () => ({ get: (_p, f) => { handler = f; } }) } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8'))((name) => { if (name in deps) return deps[name]; throw new Error('Unexpected dependency ' + name); }, mod, mod.exports);
  const pool = { query: async (q) => {
    assert.match(q.text, /^SELECT /); assert.equal(q.values[0], 'synthetic-sub');
    const answer = /FROM ff_leagues/.test(q.text) ? leagues : calls;
    if (answer instanceof Error) throw answer;
    return { rows: [answer] };
  } };
  mod.exports.createHomeSummaryRoutes({ pool });
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); } };
  await handler({ oidc: signedIn ? { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true } : null }, res);
  return res.statusCode === 200 ? res.body : { http: res.statusCode, body: res.body };
}

const H = '/api/fantasy-football/home-summary';
const NOTE = 'Shows your own linked fantasy leagues and the grading state of the start/sit calls registered for your team. Opening this never reads ESPN, changes a lineup or submits a claim — the app advises, you act.';
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const build = (body) => loadCompany({ [H]: body }).company({});

test('on open the view reads only the home summary: never the status, a lineup, a claim or a write', async () => {
  const loaded = loadCompany({ [H]: await fromRoute({ leagues: '2' }, { pending: '3', graded: '4' }) });
  await loaded.company({});
  assert.deepEqual(loaded.urls, ['GET ' + H]);
});

test('fed the JSON the real route builds, the company view shows the three counts with their tones, the note and the read time', async () => {
  const model = await build(await fromRoute({ leagues: '2' }, { pending: '3', graded: '4' }));
  assert.equal(model.kicker, 'Productivity · Fantasy Football'); assert.equal(model.title, '3 start/sit calls waiting to be graded');
  assert.match(model.lede, /^Your own fantasy team: /); assert.match(model.lede, / Read W\(\d{4}-.*\)\.$/);
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone, s.hint]), [['fantasy-leagues', '2', 'ok', null], ['calls-ungraded', '3', 'warn', null], ['graded-5d', '4', 'ok', null]]);
  assert.deepEqual(section(model, 'notes').items, [{ title: NOTE, tone: null }]);
  assert.deepEqual(model.actions.map((a) => [a.label, !!a.primary]), [['Open Fantasy Football', true]]);
});

test('the title names the account\'s state and a partial read is said as it is', async () => {
  assert.equal((await build(await fromRoute({ leagues: '0' }, { pending: '0', graded: '0' }))).title, 'No fantasy league linked yet');
  assert.equal((await build(await fromRoute({ leagues: '1' }, { pending: '0', graded: '2' }))).title, '2 calls graded in 5 days');
  assert.equal((await build(await fromRoute({ leagues: '1' }, { pending: '1', graded: '2' }))).title, '1 start/sit call waiting to be graded');
  assert.equal((await build(await fromRoute({ leagues: '1' }, { pending: '0', graded: '0' }))).title, 'No start/sit calls yet');
  const partial = await build(await fromRoute({ leagues: '1' }, new Error('synthetic outage')));
  assert.equal(partial.title, 'Some saved sources cannot be checked');
  assert.deepEqual(partial.stats.map((s) => [s.id, s.value, s.tone, s.hint]), [['fantasy-leagues', '1', 'ok', null], ['calls-ungraded', 'Unavailable', 'warn', 'Could not be checked'], ['graded-5d', 'Unavailable', 'warn', 'Could not be checked']]);
  assert.deepEqual(section(partial, 'notes').items.map((i) => [i.title, i.tone]), [['Some saved sources cannot be checked.', 'warn'], [NOTE, null]]);
});

test('every refusal is said in the card with no figure in its place, and the action leaves the view for the full page', async () => {
  const cases = [[await fromRoute({ leagues: '2' }, { pending: '3', graded: '4' }, false), 'Sign in to see your fantasy team.'], [{ http: 403, body: { error: 'Fantasy Football is not available to this account.' } }, 'Fantasy Football is not available to this account.'],
    [{ http: 503, body: { error: 'Saved evidence is unavailable.' } }, 'Saved evidence is unavailable.'], [{ http: 500, body: undefined }, 'Saved evidence cannot be checked right now (HTTP 500).'], [{ reject: true }, 'Fantasy Football could not be reached.']];
  for (const [answer, sentence] of cases) {
    const loaded = loadCompany({ [H]: answer });
    const model = await loaded.company({});
    assert.equal(model.title, 'Your fantasy team is not available right now', sentence);
    assert.equal(model.lede, sentence + ' No figure is shown in its place.');
    assert.equal(model.stats, undefined); assert.equal(model.sections, undefined);
    model.actions[0].onClick(); assert.deepEqual(loaded.assigned, ['/api/fantasy-football/']);
  }
});

test('under an audience view the page starts nothing; without one loadFantasy runs as before', () => {
  assert.match(html, /\nif \(!window\.AppView \|\| !AppView\.active\(\)\) loadFantasy\(\);\r?\n<\/script>/);
  assert.equal(html.split('\nloadFantasy();').length - 1, 0, 'no ungated top-level start');
});
