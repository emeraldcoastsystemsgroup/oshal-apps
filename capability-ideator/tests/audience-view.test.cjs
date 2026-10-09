/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour. The head block runs against a stub kit and a stub fetch, fed the JSON the REAL compiled route (routes/home-summary.js, loaded with a stub Router, a stub operator gate and a stub pool returning database-shaped rows) builds, so the view is proved against the sentence the route actually writes: on open it reads only GET /home-summary (never the loaded-applications plan, a connected-actions offer, a write or a run); the stats are the route's three counts with their tones; the runs table reads state and start from the route's detail and the latest step and saved output from its sentence (no saved step, an untitled step, no saved output, a long step or output clipped, a sentence the 2000-character clip cut short, a sentence without the fixed words); the title names the account's state (runs needing review, runs active, completed in 5 days, none completed in 5 days, nothing recorded, some evidence not checked); a 401, the route's operator 403, a 503 when every source failed, a non-JSON failure, a failure with its own error and a network failure each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to mount no connected actions, bind no Refresh handler and read nothing under the view while the full page still runs every start step.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'capability-ideator';
const PAGE = 'tools/review.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/capability-ideator"];
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
 * paints and the reads it makes. The stub formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead
 * (a body of undefined is not JSON); `{ reject: true }` fails the request itself (a network error).
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.reject) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

/**
 * @description Load the compiled route (routes/home-summary.js) with a stub Router, a stub operator gate and a stub
 * pool, and answer one GET the way Express would, so the view is fed exactly what the route builds from database rows.
 * @param {object|Error} counts The counts row (text columns running, review, completed), or an Error the query throws.
 * @param {object[]|Error} runs The newest-run rows (workflow_name, status, started_at Date, node_title, excerpt), or an Error.
 * @param {{ operator?: boolean, signedIn?: boolean }} [who] The caller; an operator who is signed in by default.
 * @returns {Promise<object>} The body the view would read (after a JSON round trip), as `{ http, body }` when the route did not answer 200.
 */
async function fromRoute(counts, runs, who) {
  const caller = Object.assign({ operator: true, signedIn: true }, who || {});
  let handler = null;
  const deps = { express: { Router: () => ({ get: (_p, f) => { handler = f; } }) }, '@/shared/middleware/authz': { isOperator: () => caller.operator } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8'))((name) => { if (name in deps) return deps[name]; throw new Error('Unexpected dependency ' + name); }, mod, mod.exports);
  const pool = { query: async (q) => {
    assert.match(q.text, /^SELECT /); assert.equal(q.values[0], 'synthetic-sub');
    const answer = /^SELECT count/.test(q.text) ? counts : runs;
    if (answer instanceof Error) throw answer;
    return { rows: Array.isArray(answer) ? answer : [answer] };
  } };
  mod.exports.createHomeSummaryRoutes({ pool });
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); } };
  await handler({ oidc: caller.signedIn ? { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true } : null }, res);
  return res.statusCode === 200 ? res.body : { http: res.statusCode, body: res.body };
}

const H = '/api/capability-ideator/home-summary';
const NOTE = 'Open discovery to inspect loaded app actions and connection requirements, then develop a sourced process proposal.';
const NOT_CHECKED = 'Some discovery evidence cannot be checked.';
const counts = (running, review, completed) => ({ running, review, completed });
/** @returns {object} A newest-run row as the route's SELECT returns it (started_at is a Date from pg). */
const row = (name, status, started, step, excerpt) => ({ workflow_name: name, status, started_at: new Date(started), node_title: step, excerpt });
const EXCERPT = '{"proposal": "Synthetic intake triage over installed apps"}';
const ROWS = [
  row('Synthetic onboarding discovery', 'error', '2026-09-28T09:00:00.000Z', 'Propose capabilities', EXCERPT),
  row('Synthetic invoice discovery', 'completed', '2026-09-27T08:00:00.000Z', 'Research sources', null),
  row('Synthetic support discovery', 'running', '2026-09-26T07:00:00.000Z', null, null),
];
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const build = (body) => loadCompany({ [H]: body }).company({});

test('on open the view reads only the home summary: never the loaded-applications plan, a connected-actions offer, a write or a run', async () => {
  const view = loadCompany({ [H]: await fromRoute(counts('1', '1', '1'), ROWS) });
  await view.company({});
  assert.deepEqual(view.urls, ['GET ' + H]);
  assert.doesNotMatch(block, /home-plan|app-workflows|app-handoff|mountConnectedActions|receiveHandoff|method: '(POST|PUT|PATCH|DELETE)'/, 'no plan, offer, handoff or write path in the view');
});

test('from the real route: the three counts with their tones, and the runs table read from the route\x27s detail and sentence', async () => {
  const model = await build(await fromRoute(counts('1', '2', '3'), ROWS));
  assert.deepEqual([model.kicker, model.title, model.actions.map((a) => a.label)], ['Engineering · Capability Ideator', '2 runs need review', ['Open Capability Ideator']]);
  assert.match(model.lede, /not ideas built or savings achieved\..*never starts a discovery run or spends on a model\.$/);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['running', 'Discovery runs active', '1', null, null],
    ['review', 'Runs needing review', '2', 'warn', null],
    ['completed', 'Runs completed / 5d', '3', 'ok', null],
  ]);
  const runs = section(model, 'runs');
  assert.deepEqual(runs.columns, ['Workflow', 'State', 'Latest step', 'Saved output', 'Started']);
  assert.deepEqual(runs.rows, [
    ['Synthetic onboarding discovery', { text: 'error', tone: 'bad' }, 'Propose capabilities', EXCERPT, 'W(2026-09-28T09:00:00.000Z)'],
    ['Synthetic invoice discovery', { text: 'completed', tone: 'ok' }, 'Research sources', 'No saved output', 'W(2026-09-27T08:00:00.000Z)'],
    ['Synthetic support discovery', { text: 'running', tone: null }, 'No step saved', 'No saved output', 'W(2026-09-26T07:00:00.000Z)'],
  ]);
  assert.match(runs.note, /not proof that a proposed tool exists, is connected, or has been implemented\./);
  assert.deepEqual(section(model, 'notes').items.map((i) => [i.title, i.tone]), [[NOTE, null]]);
});

test('the title names the account\x27s state: active, completed in 5 days, none completed in 5 days, nothing recorded', async () => {
  const one = await build(await fromRoute(counts('1', '0', '0'), ROWS.slice(2)));
  assert.equal(one.title, '1 discovery run active');
  const two = await build(await fromRoute(counts('2', '0', '1'), ROWS));
  assert.equal(two.title, '2 discovery runs active');
  const review = await build(await fromRoute(counts('3', '1', '0'), ROWS));
  assert.deepEqual([review.title, stat(review, 'review').tone], ['1 run needs review', 'warn']);
  const done = await build(await fromRoute(counts('0', '0', '1'), ROWS.slice(1, 2)));
  assert.deepEqual([done.title, stat(done, 'completed').tone], ['1 discovery run completed in 5 days', 'ok']);
  const four = await build(await fromRoute(counts('0', '0', '4'), ROWS.slice(1, 2)));
  assert.equal(four.title, '4 discovery runs completed in 5 days');
  const stale = await build(await fromRoute(counts('0', '0', '0'), ROWS.slice(1, 2)));
  assert.deepEqual([stale.title, stat(stale, 'completed').tone || null], ['No discovery run completed in 5 days', null]);
  const none = await build(await fromRoute(counts('0', '0', '0'), []));
  assert.deepEqual([none.title, section(none, 'runs').rows.length, section(none, 'runs').empty], ['No discovery runs recorded yet', 0, 'No discovery runs recorded yet. A run starts from the Capability Ideation workflow in Workflow Studio, never from this view.']);
  assert.deepEqual(section(none, 'notes').items.map((i) => [i.title, i.tone]), [[NOTE, null]]);
});

test('the step and output columns: untitled step, long step and output clipped, whitespace folded, a sentence cut short or without the fixed words', async () => {
  const long = 'x'.repeat(150), name = 'Synthetic step ' + 'y'.repeat(900);
  const model = await build(await fromRoute(counts('0', '0', '3'), [
    row('Synthetic untitled step', 'completed', '2026-09-25T10:00:00.000Z', '', '"Synthetic\n   finding"'),
    row('Synthetic long output', 'suspended', '2026-09-24T10:00:00.000Z', 'Draft proposal', long),
    row('Synthetic long step', 'escalated', '2026-09-23T10:00:00.000Z', name, 'z'.repeat(1200)),
  ]));
  assert.deepEqual(section(model, 'runs').rows.map((r) => [r[1], r[2], r[3]]), [
    [{ text: 'completed', tone: 'ok' }, 'Untitled step', '"Synthetic finding"'],
    [{ text: 'suspended', tone: 'warn' }, 'Draft proposal', 'x'.repeat(100) + '…'],
    // The route clips its sentence at 2000 characters, so the closing sentence is gone: the output runs to the end.
    [{ text: 'escalated', tone: 'warn' }, 'Synthetic step ' + 'y'.repeat(65) + '…', 'z'.repeat(100) + '…'],
  ]);
  const odd = { text: 'Synthetic odd run', detail: 'completed', fix: 'capability-ideator-review', actions: [{ integration: 'prepare-document', context: { title: 'Review capability discovery', notes: 'Synthetic unrelated sentence.' } }] };
  const oddModel = await build({ metrics: [], tiles: [], items: [odd], partial: false });
  assert.deepEqual(section(oddModel, 'runs').rows, [['Synthetic odd run', { text: 'completed', tone: 'ok' }, '—', '—', '—']]);
});

test('from the real route: a source it could not check reads as not checked, and every source failing is the route\x27s 503', async () => {
  const noRuns = await build(await fromRoute(counts('0', '1', '2'), new Error('Synthetic runs query failed')));
  assert.equal(noRuns.title, 'Some discovery evidence cannot be checked');
  assert.deepEqual([section(noRuns, 'runs').rows.length, section(noRuns, 'runs').empty], [0, 'Some discovery evidence cannot be checked.']);
  assert.deepEqual(section(noRuns, 'notes').items.map((i) => [i.title, i.tone]), [[NOT_CHECKED, 'warn']]);
  const noCounts = await build(await fromRoute(new Error('Synthetic counts query failed'), ROWS));
  assert.equal(noCounts.title, 'Some discovery evidence cannot be checked');
  assert.deepEqual(noCounts.stats.map((x) => [x.id, x.value, x.tone, x.hint]), [
    ['running', 'Unavailable', 'warn', 'Could not be checked'], ['review', 'Unavailable', 'warn', 'Could not be checked'], ['completed', 'Unavailable', 'warn', 'Could not be checked'],
  ]);
  assert.equal(section(noCounts, 'runs').rows.length, 3, 'the runs that did load still show');
  const down = await fromRoute(new Error('Synthetic counts query failed'), new Error('Synthetic runs query failed'));
  assert.equal(down.http, 503);
  await assert.rejects(build(down), /^Error: Saved evidence cannot be checked right now \(HTTP 503\)\.$/);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await build(await fromRoute(counts('0', '0', '0'), [], { signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see discovery runs', undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in\.$/);
  const denied = await build(await fromRoute(counts('0', '0', '0'), [], { operator: false }));
  assert.deepEqual([denied.title, denied.lede, denied.sections], ['This account cannot open Capability Ideator', 'The Capability Ideator summary refused this account (HTTP 403: Operator access required).', undefined]);
  const bare = await build({ http: 403, body: {} });
  assert.equal(bare.lede, 'The Capability Ideator summary refused this account (HTTP 403).');
  await assert.rejects(build({ http: 500, body: undefined }), /^Error: Saved evidence cannot be checked right now \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(build({ http: 502, body: { error: 'Synthetic summary offline' } }), /^Error: Synthetic summary offline$/, 'a failure with its own error keeps it');
  await assert.rejects(build({ reject: true }), /^Error: Saved evidence cannot be checked right now\.$/, 'a network failure is named, not shown as a raw fetch error');
});

/**
 * @description A stub element with the members the page's module script touches on start; listeners are counted.
 * @param {{ listeners: number }} calls The shared counters.
 * @returns {object} The element.
 */
function node(calls) { return { value: '', textContent: '', className: '', disabled: false, append() {}, replaceChildren() {}, addEventListener() { calls.listeners++; } }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ mounted: number, listeners: number, reads: string[] }>} Connected-actions mounts, listeners bound and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { mounted: 0, listeners: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ apps: [], metrics: [], items: [] }) }); };
  const doc = { querySelector: () => node(calls), createElement: () => node(calls) };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, doc, fetchStub, () => {}, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script mounts nothing, binds nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('company'), { mounted: 0, listeners: 0, reads: [] });
  assert.deepEqual(await runModule(null), { mounted: 1, listeners: 1, reads: ['GET /api/swarm/apps/home-plan', 'GET /api/capability-ideator/home-summary'] });
});
