/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view and its family alias asserted as behaviour: the head block runs against a stub kit and a stub fetch, fed the JSON the REAL compiled route (routes/home-summary.js, loaded with a stub Router and pool) builds from database rows; the title follows the account state, partial reads and every refusal are said with no figure in their place, the only read is the home summary, and the module start is gated after its imports.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'sports-edge';
const PAGE = 'tools/review.html';
const AUDIENCES = ["company","family"];
const ALLOWED_PREFIXES = ["/api/sports-edge"];
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
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes. The stub formatters tag their input: W = AppView.when, D = AppView.date.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead
 * (a body of undefined is not JSON); `{ reject: true }` fails the request itself (a network error).
 * @returns {{ company: Function, family: Function, urls: string[], assigned: string[] }} The builders, every request made and every navigation.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', date: (v) => 'D(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.reject) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit, location: { pathname: '/api/sports-edge/review', assign: (u) => assigned.push(u) } }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, family: config.audiences.family, urls, assigned };
}

/**
 * @description Load the compiled route (routes/home-summary.js) with a stub Router and a stub pool, and answer one GET the
 * way Express would, so the view is fed exactly what the route builds from database rows.
 * @param {object|Error} teams The followed-teams row (text column teams), or an Error the query throws.
 * @param {object[]|Error} previews The upcoming preview rows (league, home_team, away_team, game_date Date, generated_at Date), or an Error.
 * @param {boolean} [signedIn] Whether the session carries a sub (true by default).
 * @returns {Promise<object>} The body the view would read (after a JSON round trip), as `{ http, body }` when the route did not answer 200.
 */
async function fromRoute(teams, previews, signedIn = true) {
  let handler = null;
  const deps = { express: { Router: () => ({ get: (_p, f) => { handler = f; } }) } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8'))((name) => { if (name in deps) return deps[name]; throw new Error('Unexpected dependency ' + name); }, mod, mod.exports);
  const pool = { query: async (q) => {
    assert.match(q.text, /^SELECT /); assert.equal(q.values[0], 'synthetic-sub');
    const answer = /FROM sports_followed_teams WHERE/.test(q.text) && /^SELECT count/.test(q.text) ? teams : previews;
    if (answer instanceof Error) throw answer;
    return { rows: Array.isArray(answer) ? answer : [answer] };
  } };
  mod.exports.createHomeSummaryRoutes({ pool });
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); } };
  await handler({ oidc: signedIn ? { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true } : null }, res);
  return res.statusCode === 200 ? res.body : { http: res.statusCode, body: res.body };
}

const H = '/api/sports-edge/home-summary';
const preview = (league, away, home, game, built) => ({ league, away_team: away, home_team: home, game_date: new Date(game), generated_at: new Date(built) });
const PREVIEWS = [preview('NFL', 'Synthetic Falcons', 'Synthetic Saints', '2026-10-04T17:00:00.000Z', '2026-09-28T09:00:00.000Z'),
  preview('NBA', 'Synthetic Hawks', 'Synthetic Heat', '2026-10-06T23:30:00.000Z', '2026-09-28T09:00:00.000Z')];
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const build = (body) => loadCompany({ [H]: body }).company({});

test('on open the view reads only the home summary: no odds refresh, no connected-actions offer, no write', async () => {
  const loaded = loadCompany({ [H]: await fromRoute({ teams: '3' }, PREVIEWS) });
  await loaded.company({});
  assert.deepEqual(loaded.urls, ['GET ' + H]);
  assert.equal(loaded.family, loaded.company, 'the family audience is the company builder (ADR-164 D6)');
});

test('fed the JSON the real route builds, the view shows the followed teams, the upcoming games with league and start, and the note', async () => {
  const model = await build(await fromRoute({ teams: '3' }, PREVIEWS));
  assert.equal(model.kicker, 'Finance · Sports Edge'); assert.equal(model.title, '2 upcoming games with a preview');
  assert.match(model.lede, /^The teams you follow/); assert.match(model.lede, / Read W\(\d{4}-.*\)\.$/);
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone, s.hint]), [['followed-teams', '3', 'ok', null]]);
  const games = section(model, 'games');
  assert.deepEqual(games.items.map((i) => [i.title, i.text, i.meta, i.badge]), [
    ['Synthetic Falcons at Synthetic Saints', 'League: NFL', 'Starts D(2026-10-04T17:00:00.000Z)', 'NFL'],
    ['Synthetic Hawks at Synthetic Heat', 'League: NBA', 'Starts D(2026-10-06T23:30:00.000Z)', 'NBA']]);
  assert.ok(games.items.every((i) => !i.href && !i.onClick), 'a game describes; it does not act');
  assert.equal(section(model, 'notes').items.length, 1); assert.match(section(model, 'notes').items[0].title, /^Shows the caller's followed teams/);
  assert.deepEqual(model.actions.map((a) => [a.label, !!a.primary]), [['Open Sports Edge', true]]);
});

test('the title names the account\'s state and the empty and partial reads are said as they are', async () => {
  assert.equal((await build(await fromRoute({ teams: '0' }, []))).title, 'No teams followed yet');
  const quiet = await build(await fromRoute({ teams: '2' }, []));
  assert.equal(quiet.title, 'No preview for your teams this week'); assert.match(section(quiet, 'games').note, /^No cached preview matches/);
  assert.equal(section(quiet, 'notes').items[0].title, 'No saved work yet. Open the app to begin.');
  const partial = await build(await fromRoute(new Error('synthetic outage'), PREVIEWS));
  assert.equal(partial.title, 'Some saved sources cannot be checked');
  assert.deepEqual(partial.stats.map((s) => [s.value, s.tone, s.hint]), [['Unavailable', 'warn', 'Could not be checked']]);
  assert.equal(section(partial, 'notes').items[0].tone, 'warn');
});

test('every refusal is said in the card with no figure in its place, and the action leaves the view for the full page', async () => {
  const cases = [[await fromRoute({ teams: '3' }, PREVIEWS, false), 'Sign in to see your followed teams.'], [{ http: 403, body: { error: 'Sports Edge is not available to this account.' } }, 'Sports Edge is not available to this account.'],
    [{ http: 503, body: { error: 'Saved evidence is unavailable.' } }, 'Saved evidence is unavailable.'], [{ http: 500, body: undefined }, 'Saved evidence cannot be checked right now (HTTP 500).'], [{ reject: true }, 'Sports Edge could not be reached.']];
  for (const [answer, sentence] of cases) {
    const loaded = loadCompany({ [H]: answer });
    const model = await loaded.company({});
    assert.equal(model.title, 'Your teams are not available right now', sentence);
    assert.equal(model.lede, sentence + ' No figure is shown in its place.');
    assert.equal(model.stats, undefined); assert.equal(model.sections, undefined);
    model.actions[0].onClick(); assert.deepEqual(loaded.assigned, ['/api/sports-edge/review']);
  }
});

test('under an audience view the page\'s module script mounts nothing, binds nothing and reads nothing; without one it still runs every start step', () => {
  const start = html.lastIndexOf('<script type="module">'), mod = html.slice(start + 23, html.lastIndexOf('</script>'));
  const gate = mod.indexOf('if (!window.AppView || !AppView.active()) {');
  assert.ok(gate > 0 && gate > mod.lastIndexOf('import '), 'the gate follows the static imports');
  for (const step of ['await mountConnectedActions(', "document.querySelector('#refresh').addEventListener", 'await refresh();']) assert.ok(mod.indexOf(step) > gate, step + ' is inside the gate');
  assert.match(mod, /await refresh\(\);\r?\n\}\r?\n?$/, 'the gate closes after the last start step');
});
