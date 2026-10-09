/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, fed the JSON the REAL compiled route (routes/home-summary.js, loaded with a stub Router and pool) builds from database rows; the title follows the account state, partial reads and every refusal are said with no figure in their place, the only read is the home summary, and the page start is gated.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'brand-graphics';
const PAGE = 'tools/review.html';
const AUDIENCES = ["family"];
const ALLOWED_PREFIXES = ["/api/brand-graphics"];
const GATE_FILE = 'tools/review.html';

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
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes. The stub formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead
 * (a body of undefined is not JSON); `{ reject: true }` fails the request itself (a network error).
 * @returns {{ family: Function, urls: string[], assigned: string[] }} The builder, every request made and every navigation.
 */
function loadFamily(answers) {
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
  new Function('window', 'fetch', block)({ AppView: kit, location: { pathname: '/api/brand-graphics/review', assign: (u) => assigned.push(u) } }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, assigned };
}

/**
 * @description Load the compiled route (routes/home-summary.js) with a stub Router and a stub pool, and answer one GET the
 * way Express would, so the view is fed exactly what the route builds from database rows.
 * @param {object|Error} counts The counts row (text columns active, failed, five), or an Error the query throws.
 * @param {object[]|Error} jobs The newest-job rows (idea, status, updated_at Date), or an Error.
 * @param {boolean} [signedIn] Whether the session carries a sub (true by default).
 * @returns {Promise<object>} The body the view would read (after a JSON round trip), as `{ http, body }` when the route did not answer 200.
 */
async function fromRoute(counts, jobs, signedIn = true) {
  let handler = null;
  const deps = { express: { Router: () => ({ get: (_p, f) => { handler = f; } }) } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8'))((name) => { if (name in deps) return deps[name]; throw new Error('Unexpected dependency ' + name); }, mod, mod.exports);
  const pool = { query: async (q) => {
    assert.match(q.text, /^SELECT /); assert.equal(q.values[0], 'synthetic-sub');
    const answer = /^SELECT count/.test(q.text) ? counts : jobs;
    if (answer instanceof Error) throw answer;
    return { rows: Array.isArray(answer) ? answer : [answer] };
  } };
  mod.exports.createHomeSummaryRoutes({ pool });
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); } };
  await handler({ oidc: signedIn ? { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true } : null }, res);
  return res.statusCode === 200 ? res.body : { http: res.statusCode, body: res.body };
}

const H = '/api/brand-graphics/home-summary';
const NOTE = 'Only Vids jobs explicitly attributed as brand builds are counted. Completion is a saved worker result, not a publication. Review or edit the brand brief before explicitly starting a render; a connected draft consumes no rendering credits.';
const counts = (active, failed, five) => ({ active, failed, five });
const job = (idea, status, updated) => ({ idea, status, updated_at: new Date(updated) });
const JOBS = [job('Synthetic autumn intro', 'running', '2026-09-28T09:00:00.000Z'), job('Synthetic launch bumper', 'done', '2026-09-27T08:00:00.000Z'), job('Synthetic recall intro', 'failed', '2026-09-26T07:00:00.000Z')];
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const build = (body) => loadFamily({ [H]: body }).family({});

test('on open the view reads only the home summary: no render, no connected-actions offer, no write', async () => {
  const loaded = loadFamily({ [H]: await fromRoute(counts('1', '1', '2'), JOBS) });
  await loaded.family({});
  assert.deepEqual(loaded.urls, ['GET ' + H]);
});

test('fed the JSON the real route builds, the family view shows the three counts with their tones, the builds with state and update time, and the note', async () => {
  const model = await build(await fromRoute(counts('1', '1', '2'), JOBS));
  assert.equal(model.kicker, 'Creative · Brand Graphics'); assert.equal(model.title, '1 brand build in progress');
  assert.match(model.lede, /^Your brand builds: /); assert.match(model.lede, / Read W\(\d{4}-.*\)\.$/);
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone, s.hint]), [['brand-active', '1', 'ok', null], ['brand-failed', '1', 'bad', null], ['brand-done-5d', '2', 'ok', null]]);
  const builds = section(model, 'builds');
  assert.deepEqual([builds.kind, builds.title, builds.wide], ['list', 'Newest brand builds', true]);
  assert.deepEqual(builds.items.map((i) => [i.title, i.text, i.meta, i.badge, i.tone]), [
    ['Synthetic autumn intro', 'State: running', 'Updated W(2026-09-28T09:00:00.000Z)', 'running', null],
    ['Synthetic launch bumper', 'State: done', 'Updated W(2026-09-27T08:00:00.000Z)', 'done', 'ok'],
    ['Synthetic recall intro', 'State: failed', 'Updated W(2026-09-26T07:00:00.000Z)', 'failed', 'bad']]);
  assert.ok(builds.items.every((i) => !i.href && !i.onClick), 'a build describes; it does not act');
  assert.deepEqual(section(model, 'notes').items, [{ title: NOTE, tone: null }]);
  assert.deepEqual(model.actions.map((a) => [a.label, !!a.primary]), [['Open Brand Graphics', true]]);
});

test('the title names the account\'s state and the empty and partial reads are said as they are', async () => {
  assert.equal((await build(await fromRoute(counts('0', '2', '1'), JOBS))).title, '2 brand builds failed');
  assert.equal((await build(await fromRoute(counts('0', '0', '1'), JOBS))).title, '1 brand build finished in 5 days');
  assert.equal((await build(await fromRoute(counts('0', '0', '0'), JOBS))).title, 'No brand build finished in 5 days');
  const empty = await build(await fromRoute(counts('0', '0', '0'), []));
  assert.equal(empty.title, 'No brand builds yet'); assert.equal(section(empty, 'builds').items.length, 0);
  assert.match(section(empty, 'builds').note, /^Nothing recorded yet/); assert.equal(section(empty, 'notes').items[0].title, 'No saved work yet. Open the app to begin.');
  const partial = await build(await fromRoute(new Error('synthetic outage'), JOBS));
  assert.equal(partial.title, 'Some saved sources cannot be checked');
  assert.ok(partial.stats.every((s) => s.value === 'Unavailable' && s.tone === 'warn' && s.hint === 'Could not be checked'));
  assert.equal(section(partial, 'notes').items[0].title, 'Some saved sources cannot be checked.'); assert.equal(section(partial, 'notes').items[0].tone, 'warn');
  const dateless = await build(await fromRoute(counts('1', '0', '0'), [job('Synthetic undated intro', 'queued', 'not a date')]));
  assert.equal(section(dateless, 'builds').items[0].meta, 'date unavailable');
});

test('every refusal is said in the card with no figure in its place, and the action leaves the view for the full page', async () => {
  const cases = [[await fromRoute(counts('1', '1', '2'), JOBS, false), 'Sign in to see your brand builds.'], [{ http: 403, body: { error: 'Brand Graphics is not available to this account.' } }, 'Brand Graphics is not available to this account.'],
    [{ http: 503, body: { error: 'Saved evidence is unavailable.' } }, 'Saved evidence is unavailable.'], [{ http: 500, body: undefined }, 'Saved evidence cannot be checked right now (HTTP 500).'], [{ reject: true }, 'Brand Graphics could not be reached.']];
  for (const [answer, sentence] of cases) {
    const loaded = loadFamily({ [H]: answer });
    const model = await loaded.family({});
    assert.equal(model.title, 'Your brand builds are not available right now', sentence);
    assert.equal(model.lede, sentence + ' No figure is shown in its place.');
    assert.equal(model.stats, undefined); assert.equal(model.sections, undefined);
    model.actions[0].onClick(); assert.deepEqual(loaded.assigned, ['/api/brand-graphics/review']);
  }
});

test('under an audience view the page\'s module script mounts nothing, binds nothing and reads nothing; without one it still runs every start step', () => {
  const start = html.lastIndexOf('<script type="module">'), mod = html.slice(start + 23, html.lastIndexOf('</script>'));
  const gate = mod.indexOf('if (!window.AppView || !AppView.active()) {');
  assert.ok(gate > 0 && gate > mod.lastIndexOf('import '), 'the gate follows the static imports');
  for (const step of ['receiveHandoff({app', 'await mountConnectedActions(', "document.querySelector('#refresh').addEventListener", "document.querySelector('#render').addEventListener", 'await refresh();']) {
    assert.ok(mod.indexOf(step) > gate, step + ' is inside the gate');
  }
  assert.match(mod, /await refresh\(\);\r?\n\}\r?\n?$/, 'the gate closes after the last start step');
});
