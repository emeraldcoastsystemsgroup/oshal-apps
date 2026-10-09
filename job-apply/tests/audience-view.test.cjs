/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /home-summary, the one read this page has; never a write, never the connected-actions plan), that the stats are the route's five ledger counts with their tones (failed or unknown wants attention, a verified count is the one figure backed by retained confirmation evidence, an unavailable count is named as not checked), that the title ladder names the account's state (failed or unknown to review, runs active, verified in five days, no runs active, no runs yet, some sources not checked), that the runs table reads company, state and last update from the route's detail string (a company that itself carries a slash, an underscore state shown with spaces, the route's own 'date unavailable' passed through), that the notes list carries the route's own non-run sentences, and that a 401, a 403, a 503 with the route's body, a non-JSON failure and a failure with its own error each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to bind no handoff listener, mount no connected actions and read nothing under the view while the full page still runs every start step.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'job-apply';
const PAGE = 'tools/review.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/job-apply"];
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
 * paints and the reads it makes. The stub relative-time formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', date: (v) => 'T(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

const H = '/api/job-apply/home-summary';
const NOW = '2026-09-28T12:00:00.000Z';
/** @returns {object[]} The route's five metrics (mirrored as tiles), each value a digit string or 'Unavailable'. */
const metrics = (active, review, manual, day, five) => [
  { id: 'runs-active', label: 'Submission runs active', value: active },
  { id: 'runs-review', label: 'Failed / unknown runs', value: review },
  { id: 'manual-marks', label: 'Manually marked runs', value: manual },
  { id: 'verified-24h', label: 'Verified submissions/24h', value: day },
  { id: 'verified-5d', label: 'Verified submissions/5d', value: five },
];
/** @returns {string} A run item's detail exactly as routes/home-summary.js writes it. */
const detail = (company, state, updated) => company + ' / ' + state + ' / ' + updated;
/** @returns {object} A run item with the route's two continuation offers and its tone for a failed or unknown state. */
const run = (title, company, state, updated) => ({ text: title, detail: detail(company, state, updated), tone: ['failed', 'unknown_outcome'].includes(state) ? 'warn' : 'neutral', fix: 'job-apply-review',
  actions: ['review-career', 'prepare-document'].map((integration) => ({ integration, context: { title, notes: detail(company, state, updated) + '\nPosting p1. State comes from the authoritative Apply run ledger.' } })) });
const LEDGER = { text: 'Uses the authoritative Apply V2 ledger, not workflow completion. Verified counts are distinct posting IDs in each rolling completion window with retained confirmation path/hash; no private path is exposed. Active, failed/unknown and manually marked runs remain separate. Review in Career or prepare a follow-up document; Home never retries a submission.', tone: 'neutral', fix: 'job-apply-review' };
const NO_WORK = { text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: 'job-apply-review' };
const NOT_CHECKED = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'job-apply-review' };
/** @returns {object} A home summary as the route answers it: tiles mirror metrics, run items first, the notes last. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m, items, asOf: NOW, partial: !!partial });
const RUNS = [
  run('Synthetic Staff Engineer', 'Synthetic Robotics', 'failed', '2026-09-28T10:00:00.000Z'),
  run('Synthetic Platform Lead', 'Synthetic Cloud / Edge Co', 'queued_to_worker', '2026-09-27T09:00:00.000Z'),
  run('Application p3', 'Company unavailable', 'submitted_verified', 'date unavailable'),
];
const OK = { [H]: summary(metrics('1', '1', '0', '1', '2'), RUNS.concat([LEDGER])) };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const build = (body) => loadCompany({ [H]: body }).company({});

test('on open the view reads only the home summary: never a write, never the connected-actions plan', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual(view.urls, ['GET ' + H]);
});

test('the stats are the route\x27s five ledger counts with their tones, and the runs table reads company, state and last update from the detail string', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.actions.map((a) => a.label)], ['Knowledge · Job Apply', '1 failed or unknown run to review', ['Review the failed runs']]);
  assert.match(model.lede, /Apply run ledger rather than workflow completion\./);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['runs-active', 'Submission runs active', '1', null, null],
    ['runs-review', 'Failed / unknown runs', '1', 'warn', null],
    ['manual-marks', 'Manually marked runs', '0', null, null],
    ['verified-24h', 'Verified submissions/24h', '1', 'ok', null],
    ['verified-5d', 'Verified submissions/5d', '2', 'ok', null],
  ]);
  const runs = section(model, 'runs');
  assert.deepEqual(runs.columns, ['Application', 'Company', 'State', 'Updated']);
  assert.deepEqual(runs.rows, [
    ['Synthetic Staff Engineer', 'Synthetic Robotics', { text: 'failed', tone: 'warn' }, 'W(2026-09-28T10:00:00.000Z)'],
    ['Synthetic Platform Lead', 'Synthetic Cloud / Edge Co', { text: 'queued to worker', tone: null }, 'W(2026-09-27T09:00:00.000Z)'],
    ['Application p3', 'Company unavailable', { text: 'submitted verified', tone: 'ok' }, 'date unavailable'],
  ]);
  assert.match(runs.note, /Review in Career before retrying or contacting anyone\.$/);
  assert.deepEqual(section(model, 'notes').items.map((i) => [i.title, i.tone]), [[LEDGER.text, null]]);
});

test('the title names the account\x27s state: runs active, verified in five days, no runs active, no runs yet', async () => {
  const active = await build(summary(metrics('2', '0', '0', '0', '0'), [RUNS[1], LEDGER]));
  assert.deepEqual([active.title, active.actions[0].label], ['2 submission runs active', 'Open Submission Review']);
  const verified = await build(summary(metrics('0', '0', '0', '1', '3'), [RUNS[2], LEDGER]));
  assert.deepEqual([verified.title, stat(verified, 'verified-5d').tone], ['3 verified submissions in 5 days', 'ok']);
  const manual = await build(summary(metrics('0', '0', '1', '0', '0'), [run('Application p4', 'Synthetic Co', 'manual_mark', NOW), LEDGER]));
  assert.deepEqual([manual.title, stat(manual, 'manual-marks').tone || null, section(manual, 'runs').rows[0][2]], ['No submission runs active', null, { text: 'manual mark', tone: null }]);
  const none = await build(summary(metrics('0', '0', '0', '0', '0'), [NO_WORK, LEDGER]));
  assert.deepEqual([none.title, section(none, 'runs').rows.length, section(none, 'runs').empty], ['No submission runs yet', 0, 'No submission runs recorded yet. Runs appear here once a job-apply ticket has been pushed.']);
  assert.deepEqual(section(none, 'notes').items.map((i) => [i.title, i.tone]), [[NO_WORK.text, null], [LEDGER.text, null]]);
});

test('a source the route could not check reads as not checked: the count is named unavailable, the runs that did load still show', async () => {
  const some = await build(summary(metrics('Unavailable', 'Unavailable', 'Unavailable', '1', '2'), [RUNS[2], NOT_CHECKED, LEDGER], true));
  assert.equal(some.title, 'Some saved sources cannot be checked');
  assert.deepEqual([stat(some, 'runs-active').value, stat(some, 'runs-active').tone, stat(some, 'runs-active').hint, stat(some, 'verified-5d').tone], ['Unavailable', 'warn', 'Could not be checked', 'ok']);
  assert.deepEqual([section(some, 'runs').rows.length, section(some, 'notes').items.map((i) => [i.title, i.tone])], [1, [[NOT_CHECKED.text, 'warn'], [LEDGER.text, null]]]);
  const noRows = await build(summary(metrics('0', '0', '0', 'Unavailable', 'Unavailable'), [NOT_CHECKED, LEDGER], true));
  assert.deepEqual([noRows.title, section(noRows, 'runs').rows.length, section(noRows, 'runs').empty], ['Some saved sources cannot be checked', 0, 'Some saved sources cannot be checked.']);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await build({ http: 401, body: { error: 'not_authenticated' } });
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see submission runs', undefined, undefined]);
  const denied = await build({ http: 403, body: {} });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Job Apply', 'The Job Apply routes refused this account (HTTP 403).']);
  // Every source failed: the route answers 503 with its own body (counts Unavailable, the not-checked note) and no error field.
  await assert.rejects(build({ http: 503, body: summary(metrics('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'), [NOT_CHECKED, LEDGER], true) }), /^Error: Saved evidence cannot be checked right now \(HTTP 503\)\.$/);
  await assert.rejects(build({ http: 500, body: undefined }), /^Error: Saved evidence cannot be checked right now \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(build({ http: 502, body: { error: 'Synthetic ledger offline' } }), /^Error: Synthetic ledger offline$/, 'a failure with its own error keeps it');
});

/** @returns {object} A stub element with the members the page's module script touches on start. */
function node() { return { value: '', textContent: '', className: '', disabled: false, append() {}, replaceChildren() {}, addEventListener() {} }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ handoffs: number, mounted: number, reads: string[] }>} Handoff listeners bound, connected-actions mounts and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { handoffs: 0, mounted: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [] }) }); };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { querySelector: node, createElement: node }, fetchStub, () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script binds nothing, mounts nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('company'), { handoffs: 0, mounted: 0, reads: [] });
  assert.deepEqual(await runModule(null), { handoffs: 1, mounted: 1, reads: ['GET /api/job-apply/home-summary'] });
});
